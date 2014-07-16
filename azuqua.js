
var async = require("async"),
  _ = require("underscore"),
  fs = require("fs"),
  crypto = require("crypto"),
  RestJS = require("restjs"),
  Promise = require("bluebird"),
  path = require("path");

  if(RestJS.Rest)
    RestJS = RestJS.Rest;

// Azuqua Node.js Client Library
// -----------------------------

// This library provides an easy interface for interacting with your Azuqua flos.
// The Azuqua API is directly exposed to developers should you wish to write your own library.
// For full API documentation please visit <a href="//developer.azuqua.com">developer.azuqua.com</a>.

// In order to make API requests you will need both your accessKey and accessSecret.
// These can be found on your account information page. 

// Since using an Azuqua client is the most secure way to invoke a flo 
// any published flo can be invoked with the credentials provided by this client, regardless of the flo's security level.

// All asynchronous functions can return a promise if you prefer that pattern.
// By default when you call an asynchronous function and 
// leave the callback undefined it will return a promise.
// By default Azuqua uses <a href="https://github.com/petkaantonov/bluebird">bluebird</a>.

// Should you wish to write your own library that makes HTTP requests directly you will need to provide the following headers with each request:

// `x-api-accessKey: "your access key",` <br/>
// `x-api-hash: "the hexidecimal string output of a HMAC-SHA256 of the data and some metadata signed by your accessSecret (see the signData function)",` <br/>
// `x-api-timestamp: "an ISO timestamp of the current time"`

// Also note that the API rate limits all clients by the maximum number of requests per second
// as determined by your account plan. By default this is 3 requests per second.

// Flos are not directly invocable via their name. To invoke a flo you first need to 
// get the alias for the flo. These can be found at the /api/account/flos route. This client maintains
// an internal mapping between each flo name and its alias so you can invoke flos directly by their name.
// Aliases are designed to be disposable so the flo maintainer can obfuscate endpoints as needed. 

var routes = {
  invoke: { 
    path: "/flo/:id/invoke",
    method: "POST"
  },
  flos: {
    path: "/account/flos",
    method: "GET"
  }
};

var wrapAsyncFunction = function(fn, args){
  args = Array.prototype.slice.call(args);
  var callback = args[args.length - 1];
  if(typeof callback !== "function"){
    var deferred = Promise.defer();
    args.push(function(error, data){
      if(error)
        deferred.reject(error);
      else
        deferred.resolve(data);
    });
    fn.apply(fn, args);
    return deferred.promise;
  }else{
    fn.apply(fn, args);
  }
};

var signData = function(accessSecret, data, verb, path, timestamp){
  if(!data)
    data = "";
  else if(typeof data === "object")
    data = JSON.stringify(data);
  var meta = [verb.toLowerCase(), path, timestamp].join(":");
  return crypto.createHmac("sha256", accessSecret).update(meta + data).digest("hex");
};

var addGetParameter = function(path, key, value){
  var delimiter = path.indexOf("?") > -1 ? "&" : "?";
  return path + delimiter + encodeURIComponent(key) + "=" + encodeURIComponent(value);
};

var getAlias = function(map, str){
  return map[str] || _.find(map, function(v){ return v === str; });
};

// Constructor
// -----------

// Create a new Azuqua client.

// This function first attempts to read accessKey and accessSecret data from environment variables.
// These can be set with ACCESS_KEY and ACCESS_SECRET. 
// It then attempts to read them from the function's arguments.
// You can overwrite the environment variables this way if necessary, 
// although it's not recommended to hard-code your account credentials.
var Azuqua = function(accessKey, accessSecret){
  var self = this;

  self.account = {};
  if(process.env.ACCESS_KEY)
    self.account.accessKey = process.env.ACCESS_KEY;
  if(process.env.ACCESS_SECRET)
    self.account.accessSecret = process.env.ACCESS_SECRET;
  if(typeof accessKey === "string")
    self.account.accessKey = accessKey;
  if(typeof accessSecret === "string")
    self.account.accessSecret = accessSecret;

  self.httpOptions = {
    host: "api.azuqua.com", 
    port: 443, 
    headers: {
      "Content-Type": "application/json"
    }
  };

  self.client = new RestJS({ protocol: "https" });

  self.makeRequest = function(options, params, callback){
    if(!self.account || !self.account.accessKey || !self.account.accessSecret)
      return callback(new Error("Account information not found"));
    _.each(self.httpOptions, function(value, key){
      options[key] = value;
    });
    var timestamp = new Date().toISOString();
    if(!params || Object.keys(params).length < 1)
      params = "";
    var hash = signData(self.account.accessSecret, params, options.method, options.path, timestamp);
    if(options.method === "GET"){
      _.each(params, function(key, value){
        options.path = addGetParameter(options.path, key, value);
      });
    }else{
      params = JSON.stringify(params);
    }
    if(options.method === "POST")
      options.headers["Content-Length"] = Buffer.byteLength(params);
    options.headers["x-api-timestamp"] = timestamp;
    options.headers["x-api-hash"] = hash;
    options.headers["x-api-accessKey"] = self.account.accessKey;
    self.client.request(options, params, function(error, resp){
      if(error){
        callback(error);
      }else{
        try{
          resp.body = JSON.parse(resp.body);
        }catch(e){
          return callback(resp.body);
        }
        if(resp.body.error)
          callback(new Error(resp.body.error));
        else
          callback(null, resp.body);
      }
    });
  };

};

// Account Configuration
// ---------------------

// <strong>loadConfig</strong>

// Read accessKey and accessSecret data from a .json file.

// Note: This function blocks. Use loadConfigAsync for the async variant.
Azuqua.prototype.loadConfig = function(configPath){
  // Resolve the config path from the requiring parent's location if it's relative
  configPath = path.resolve(path.dirname(module.parent.filename), configPath);
  this.account = require(configPath);
};

// <strong>loadConfigAsync</strong>

// Asynchronously read accessKey and accessSecret data from a .json file.
Azuqua.prototype.loadConfigAsync = function(_path, _callback){
  var self = this;
  return wrapAsyncFunction(function(path, callback){
    fs.readFile(path, { encoding: "utf8" }, function(error, data){
      if(error){
        callback(error);
      }else{
        try{
          data = JSON.parse(data);
        }catch(e){
          return callback(e);
        }
        if(data.accessKey && data.accessSecret){
          self.account = data;
          callback(null, true);
        }else{
          callback(new Error("Invalid account credentials"));
        }
      }
    });
  }, arguments);
};

// API Functions
// -------------

// <strong>flos</strong>

// List all flos for your organization.

// Note: This caches the flos locally. To refresh them provide a truthy first parameter.
Azuqua.prototype.flos = function(_refresh, _callback){
  var self = this;
  return wrapAsyncFunction(function(refresh, callback){
    if(typeof refresh === "function"){
      callback = refresh;
      refresh = false;
    }
    if(self.floMap && !refresh){
      callback(null, Object.keys(self.floMap));
    }else{
      self.makeRequest(routes.flos, null, function(error, flos){
        if(error){
          callback(error);
        }else{
          self.floMap = {};
          var out = [];
          async.each(flos, function(flo, cb){
            if(!self.floMap[flo.name])
              out.push(flo.name);
            self.floMap[flo.name] = flo.alias;
            cb();
          }, function(){
            callback(null, out);
          });
        }
      });
    }
  }, arguments);
};

// <strong>invoke</strong>

// Invoke a Flo identified by @flo with @data.
// @flo is a string representing the flo name.
// If you try to invoke a flo whose alias cannot be found the client will first attempt to refresh
// the flos cache once. Failing that it will call the callback or reject the promise with an error.
// If the optional parameter @force is true then it will attempt to invoke the flo without
// using the cache. Use this to avoid an extra network request if you already know the alias. 
Azuqua.prototype.invoke = function(_flo, _data, _force, _callback){
  var self = this;
  return wrapAsyncFunction(function(flo, data, force, callback){
    if(typeof force === "function" && !callback){
      callback = force;
      force = false;
    }
    var alias = getAlias(self.floMap || {}, flo);
    if(!alias && force)
      alias = flo;
    if(alias){
      var options = _.extend({}, routes.invoke);
      options.path = options.path.replace(":id", alias);
      self.makeRequest(options, data, callback);
    }else{
      self.flos(true).then(function(){
        alias = getAlias(self.floMap, flo);
        if(alias)
          self.invoke(alias, data, callback);
        else
          callback(new Error("Flo not found"));
      }, callback);
    }
  }, arguments);
};

module.exports = Azuqua;
