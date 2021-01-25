const mqtt = require('mqtt');
const UrlPattern = require('url-pattern');

class ServerConnectionOptions {
  constructor() {
    this.options = {
      mqttEndpoint: null,
      mqttUsername: 'remoteclient',
      mqttPassword: null,
      hardwareType: null,
      serialNumber: null,
      whitelist: []
    };
  }

  set(key, value) {
    if(this.options[key] === undefined) {
      throw "Invalid key provided (" + key + ")";
    }

    if(value === undefined) {
      throw "Invalid value provided, undefined (" + key + ")";
    }

    this.options[key] = value;
  }

  get(key) {
    if(this.options[key] === undefined) {
      throw "Invalid key requested (" + key + ")";
    }

    return this.options[key];
  }
}

class ServerConnection {
  constructor(options) {
    if(!options instanceof ServerConnectionOptions) {
      throw "Options must be passed";
    }

    this.hardwareType = options.get('hardwareType');
    this.serialNumber = options.get('serialNumber');
    this.whitelist = options.get('whitelist');

    this.mqttEndpoint = options.get('mqttEndpoint');
    this.mqttUsername = options.get('mqttUsername');
    this.mqttPassword = options.get('mqttPassword');

    var parent = this;

    console.log('MQTT Local', 'Connecting');

    var localClient = mqtt.connect('mqtt://localhost');

    localClient.on('connect', () => {
      console.log('MQTT Local', 'Connected');

      remoteClient.subscribe(parent.hardwareType + '/' + parent.serialNumber + '/#');
      remoteClient.subscribe('coordinator/#');
    });

    localClient.on('message', function (topic, message) {
      console.log('MQTT Local', 'Message', topic, message.toString());

      if(parent.checkWhitelist(topic)) {
        localClient.publish(topic, message);
      } else {
        console.log('MQTT Local', 'Message not whitelisted');
      }
    });

    console.log('MQTT Remote', 'Connecting', this.mqttEndpoint, this.serialNumber);

    var options = {
      username: this.mqttUsername,
      password:  this.mqttPassword
    };

    var remoteClient  = mqtt.connect(this.mqttEndpoint, options)

    remoteClient.on('connect', function () {
      console.log('MQTT Remote', 'Connected');

      remoteClient.subscribe(parent.hardwareType + '/' + parent.serialNumber + '/#');
      remoteClient.subscribe('coordinator/#');

      remoteClient.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-device', JSON.stringify(parent.getDeviceRegistration()));
    })

    remoteClient.on('message', function (topic, message) {
      console.log('MQTT Remote', 'Message', topic, message.toString());

      if(parent.checkWhitelist(topic)) {
        localClient.publish(topic, message);
      } else {
        console.log('MQTT Remote', 'Message not whitelisted');
      }

      var infoPattern = new UrlPattern(':hardwareType/:serialNumber/device-info/request/(:id)');

      if(infoPattern.match(topic)) {
        var params = infoPattern.match(topic);

        var topic = parent.hardwareType + '/' + parent.serialNumber + '/device-info/response';

        if(params.id !== undefined) {
          topic += '/' + params.id;
        }

        remoteClient.publish(topic, JSON.stringify(parent.getDeviceRegistration()));
      }

      var presencePattern = new UrlPattern(':hardwareType/:serialNumber/presence-check/request/(:id)');

      if(presencePattern.match(topic)) {
        var params = presencePattern.match(topic);

        var topic = parent.hardwareType + '/' + parent.serialNumber + '/presence-check/response';

        if(params.id !== undefined) {
          topic += '/' + params.id;
        }

        remoteClient.publish(topic, JSON.stringify({
          timestamp: new Date().getTime()
        }));
      }

      if(topic == 'coordinator/device-info/request') {
        remoteClient.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-device', JSON.stringify(parent.getDeviceRegistration()));
      }
    })
  }

  getDeviceRegistration() {
    return {
      timestamp: new Date().getTime()
    };
  }

  checkWhitelist(topic) {
    for(var i in this.whitelist) {
      var pattern = new UrlPattern(this.whitelist[i]);

      if(pattern.match(topic)) {
        return true;
      }
    }

    return false;
  }
}

module.exports = {
  ServerConnectionOptions: ServerConnectionOptions,
  ServerConnection: ServerConnection
};
