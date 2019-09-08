const Promise = require('bluebird');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const auth = require('./auth');

AWS.config.update({ region: 'us-east-1' });

const exec = Promise.promisify(childProcess.exec, { context: childProcess });
const polly = new AWS.Polly();
const synthesizeSpeech = Promise.promisify(polly.synthesizeSpeech, { context: polly });
const ssm = new AWS.SSM();
const getParameter = Promise.promisify(ssm.getParameter, { context: ssm });
fs.copyFileSync(`${process.env.LAMBDA_TASK_ROOT}/bin/sox`, '/tmp/sox');
fs.chmodSync('/tmp/sox', '777');

function speechQuery(text) {
  const tempDirectory = '/tmp';
  const filePath = (fileName) => path.resolve(tempDirectory, fileName);
  const metadataPath = path.resolve(__dirname, 'metadata.json');

  // Create a temporary working directory
  if (!fs.existsSync(tempDirectory)) {
    fs.mkdirSync(tempDirectory);
  }

  // Convert text to speech
  const params = {
    LexiconNames: [],
    OutputFormat: 'mp3',
    SampleRate: '16000',
    Text: text,
    TextType: 'text',
    VoiceId: 'Joanna',
  };
  return synthesizeSpeech(params)
    .then((data) => {
      fs.writeFileSync(filePath('polly.mp3'), data.AudioStream);
      // Convert audio to avs accepted format
      return exec([
        '/tmp/sox',
        filePath('polly.mp3'),
        '-c 1 -r 16000 -e signed -b 16',
        filePath('avs_request.wav'),
      ].join(' '));
    })
    .then(() => getParameter({
      Name: '/alexa-guard/dev/alexa-guard-token',
      WithDecryption: true,
    }))
    .then(({ Parameter }) => (
      exec([
        'curl -i -k',
        `-H "Authorization: Bearer ${Parameter.Value}"`,
        `-F "metadata=<${metadataPath};type=application/json; charset=UTF-8"`,
        `-F "audio=<${filePath('avs_request.wav')};type=audio/L16; rate=16000; channels=1"`,
        `-o ${filePath('avs_response.txt')}`,
        'https://access-alexa-na.amazon.com/v1/avs/speechrecognizer/recognize',
      ].join(' '))
    ));
}

const handler = (event) => {
  if (event.source === 'aws.events') {
    console.log('Refreshing auth tokens...');
    return auth.refresh();
  }
  if (event.path === '/guard' && event.httpMethod === 'POST') {
    const { enabled } = event.queryStringParameters;
    const query = enabled === 'true' ? 'turn on guard' : 'turn off guard';
    console.log(`Performing speech query: ${query}`);
    return speechQuery(query)
      .then(() => ({ statusCode: 200 }))
      .catch(() => ({ statusCode: 500 }));
  }
  return Promise.reject(new Error('unsupported event'));
};

module.exports = { handler };
