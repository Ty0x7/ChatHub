const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const definition = loader.loadSync(path.join(__dirname,'stream_list.proto'), { keepCase: false, enums: String, longs: String, defaults: false, oneofs: true });
const service = grpc.loadPackageDefinition(definition).youtube.api.v3.V3DataLiveChatMessageService;
function createClient() { return new service('youtube.googleapis.com:443', grpc.credentials.createSsl(), { 'grpc.keepalive_time_ms': 60000, 'grpc.keepalive_timeout_ms': 20000, 'grpc.max_receive_message_length': 8 * 1024 * 1024 }); }
function openStream(client, token, request) {
  const metadata = new grpc.Metadata(); metadata.set('authorization',`Bearer ${token}`);
  return client.streamList(request,metadata,{deadline:Date.now()+50*60*1000});
}
module.exports={createClient,openStream,service,grpc};
