var base = require("../../client/base"),
    error = require("../../client/error"),
    urljoin = require("../../client/utils").urljoin;


var ServerManager = base.Manager.extend({
  namespace: "servers",

  get_base_url: function (params) {
    var base_url = this._super(params);
    if (params.detail) {
      base_url = this.urljoin(base_url, 'detail');
    }
    return base_url;
  },

  get: function (params, callback) {
    // get_addresses_for_instance also uses this method, so let's not
    // clobber our parsing functions.
    if (!params.parseResult) {
      params.parseResult = function (result) {
        Object.keys(result.addresses).forEach(function (network_name) {
          result.addresses[network_name].forEach(function (address) {
            address.network = network_name;
          });
        });
        return result;
      };
    }
    return this._super(params, callback);
  },

  all: function (params, callback) {
    if (typeof params.detail === "undefined") params.detail = true;
    params.parseResult = function (results) {
      results.forEach(function (item) {
        Object.keys(item.addresses).forEach(function (network_name) {
          item.addresses[network_name].forEach(function (address) {
            address.network = network_name;
          });
        });
      });
      return results;
    };
    return this._super(params, callback);
  },

  create: function (params, callback) {
    if (!params.data.name) {
      params.data.name = null;
    }

    // Convenience method for simplest boot-from-volume case; parity with boot from image.
    // NOT REFLECTIVE OF THE UNDERLYING API.
    // TODO: Support full block device mapping featureset.
    if (params.data.volumeRef || params.data.snapshotRef) && !params.data.imageRef) {
      params.data.block_device_mapping = [{
        device_name: 'vda',
        delete_on_termination: 0,
        boot_index: 0
      }];

      if (params.data.volumeRef) {
        params.data.block_device_mapping[0]['source_type'] = 'volume';
        params.data.block_device_mapping[0]['volume_id'] = params.data.volumeRef;
        params.data.block_device_mapping[0]['uuid'] = params.data.volumeRef;
      } else {
        params.data.block_device_mapping[0]['source_type'] = 'snapshot';
        params.data.block_device_mapping[0]['snapshot_id'] = params.data.snapshotRef;
        params.data.block_device_mapping[0]['uuid'] = params.data.snapshotRef;
      }

      delete params.data.volumeRef;
    }

    if (params.data.security_groups) {
      if (Object.prototype.toString.call(params.data.security_groups) !== '[object Array]') {
        params.data.security_groups = [params.data.security_groups];
      }
      params.data.security_groups = params.data.security_groups.map(function (sg) {
        return {"name": sg};
      });
    }

    if (params.data.scheduler_hints) {
      params.data['os:scheduler_hints'] = params.data.scheduler_hints;
      delete params.data.scheduler_hints;
    }

    if (params.data.networks) {
      var networks = [];
      if (!Array.isArray(params.data.networks)) {
        params.data.networks = [params.data.networks];
      }
      params.data.networks.forEach(function (network_id) {
        networks.push({"uuid": network_id});
      });
      params.data.networks = networks;
    }

    // Base64 encode user data if present
    if (params.data.user_data) {
      // Use Buffer built-in if in Node, otherwise use btoa in the browser
      if (typeof Buffer !== 'undefined') {
        params.data.user_data = new Buffer(params.data.user_data).toString('base64');
      } else {
        params.data.user_data = btoa(params.data.user_data);
      }
    }
    return this._super(params, callback);
  },

  security_groups: function (params, callback) {
    var url = urljoin(this.get_base_url(params), params.id || params.data.id, "os-security-groups");
    params.result_key = 'security_groups';
    params = this.prepare_params(params, url, "singular");
    return this.client.get(params, callback);
  },

  attachments: function (params, callback) {
    var url = urljoin(this.get_base_url(params), params.id || params.data.id, "os-volume_attachments");
    params.result_key = 'volumeAttachments';
    params = this.prepare_params(params, url, "singular");
    return this.client.get(params, callback);
  },

  attach: function (params, callback) {
    var url = urljoin(this.get_base_url(params), params.id || params.data.id, "os-volume_attachments");
    params.result_key = 'volumeAttachment';
    params.data.device = params.data.device || null;
    params = this.prepare_params(params, url, "singular");
    params.data.volumeAttachment = params.data.server;
    delete params.data.server;
    return this.client.post(params, callback);
  },

  detach: function (params, callback) {
    var url = urljoin(this.get_base_url(params), params.id || params.data.id, "os-volume_attachments", params.data.volumeId);
    delete params.data;
    params = this.prepare_params(params, url, "singular");
    return this.client.del(params, callback);
  },

  volumes: function (params, callback) {
    var Cinder = require("../../cinder/v1/client");  // Avoid circular imports.

    var manager = this,
        cinder = new Cinder(this.client),
        success = params.success,
        error = params.error;

    if (params.success) delete params.success;
    if (params.error) delete params.error;

    return this.attachments(params, function (err, results, xhr) {
      if (err) return manager.safe_complete(err, null, xhr, {error: error}, callback);

      var new_params = {
        success: success,
        error: error,
        data: {
          ids: []
        }
      };

      results.forEach(function (result) {
        new_params.data.ids.push(result.id);
      });

      cinder.volumes.in_bulk(new_params, callback);
    });
  },

  _action: function (params, action, info, callback) {
    var url = urljoin(this.get_base_url(params), params.id || params.data.id, "action");
    if (params.data && params.data.id) delete params.data.id;
    params = this.prepare_params(params, url, "singular");
    params.data[action] = info || null;
    return this.client.post(params, callback);
  },

  reboot: function (params, callback) { return this._action(params, "reboot", {type: 'HARD'}, callback); },

  migrate: function (params, callback) { return this._action(params, "migrate", null, callback); },

  stop: function (params, callback) { return this._action(params, "os-stop", null, callback); },
  start: function (params, callback) { return this._action(params, "os-start", null, callback); },

  pause: function (params, callback) { return this._action(params, "pause", null, callback); },
  unpause: function (params, callback) { return this._action(params, "unpause", null, callback); },

  lock: function (params, callback) { return this._action(params, "lock", null, callback); },
  unlock: function (params, callback) { return this._action(params, "unlock", null, callback); },

  suspend: function (params, callback) { return this._action(params, "suspend", null, callback); },
  resume: function (params, callback) { return this._action(params, "resume", null, callback); },

  rescue: function (params, callback) { return this._action(params, "rescue", null, callback); },
  unrescue: function (params, callback) { return this._action(params, "unrescue", null, callback); },

  set_active_state: function (params, callback) { return this._action(params, "os-resetState", {state: "active"}, callback); },
  set_error_state: function (params, callback) { return this._action(params, "os-resetState", {state: "error"}, callback); },

  snapshot: function (params, callback) {
    var extra = {name: params.data.name, metadata: {}};
    params.id = params.id || params.data.id;
    params.data = {};
    return this._action(params, "createImage", extra, callback);
  },

  getConsole: function (params, callback) {
    var instance_id = params.id || params.data.id,
        type = params.data.type || "novnc",
        action = type === "spice-html5" ? "os-getSPICEConsole" : "os-getVNCConsole";
    params.result_key = "console";
    params.parseResult = function (result) {
      result.id = instance_id;
      return result;
    };
    return this._action(params, action, {"type": type}, callback);
  },

  getLog: function (params, callback) {
    params.id = params.id || params.data.id;
    params.result_key = "output";
    params.parseResult = function (result) {
      return {id: params.id, data: result};
    };
    return this._action(params, "os-getConsoleOutput", {length: params.data.length || 100}, callback);
  },

  get_addresses_for_instance: function (params, callback) {
    // Convenience method for returning all the addresses associated with
    // the specific instance in a flattened list-friendly format. Useful for
    // making selects for floating IP management, etc.
    params.parseResult = function (result) {
      var addresses = [];
      Object.keys(result.addresses).forEach(function (network_name) {
        result.addresses[network_name].forEach(function (address) {
          address.id = address.addr;
          address.network = network_name;
          addresses.push(address);
        });
      });
      return addresses;
    };
    this.get(params, callback);
  },

  add_floating_ip: function (params, callback) {
    var manager = this,
        fixed_address = params.data.fixed_address;

    function finish(address) {
      delete params.data;
      var data = {'address': address};
      if (fixed_address) data.fixed_address = fixed_address;
      return manager._action(params, 'addFloatingIp', data, callback);
    }

    params.id = params.id || params.data.id;
    if (params.data && params.data.address) {
      return finish(params.data.address);
    } else {
      var client = this.client;
      return client.floating_ips.all({
        success: function (ips) {
          var available;

          ips.forEach(function (ip) {
            if (available) return;
            if (!ip.instance_id) available = ip.ip;
          });

          if (available) {
            return finish(available);
          } else {
            client.floating_ips.create({
              success: function (ip) {
                return finish(ip.ip);
              },
              error: function (err, xhr) {
                manager.safe_complete(err, null, xhr, params, callback);
              }
            });
          }
        },
        error: function (err, xhr) {
          manager.safe_complete(err, null, xhr, params, callback);
        }
      });
    }
  },

  remove_floating_ip: function (params, callback) {
    var manager = this;

    function finish(address) {
      delete params.data;
      return manager._action(params, 'removeFloatingIp', {'address': address}, callback);
    }

    params.id = params.id || params.data.id;
    if (params.data && params.data.address) {
      return finish(params.data.address);
    } else {
      var client = this.client;
      return client.floating_ips.all({
        success: function (ips) {
          var associated;

          ips.forEach(function (ip) {
            if (associated) return;
            if (ip.instance_id === params.id) associated = ip.ip;
          });

          if (associated) {
            return finish(associated);
          } else {
            var err = {
              message: 'No floating IP associated with this instance.',
              status: 400
            };
            manager.safe_complete(err, null, {status: 400}, params, callback);
          }
        },
        error: function (err, xhr) {
          manager.safe_complete(err, null, xhr, params, callback);
        }
      });
    }
  },

  // TODO: Methods implemented by python-novaclient which are not yet implemented here...
  // add_fixed_ip
  // remove_fixed_ip
  // add_security_group
  // remove_security_group
  // resize
  // rebuild
  // confirm_resize
  // revert_resize
  // backup
  // set_meta
  // delete_meta
  // live_migrate
  // change_password
  // diagnostics
  // actions

  _rpc_to_api: function (rpc) {
    // Utility method to convert an RPC "notification"-style object into one
    // which resembles data returned by the API for compatibility purposes.
    var api = {};
    api.id = rpc.instance_id;
    api.name = rpc.display_name;
    api.user_id = rpc.user_id;
    api.tenant_id = rpc.tenant_id;
    api.status = rpc.state.toUpperCase();
    api["OS-EXT-STS:task_state"] = (rpc.state_description ? rpc.state_description : null);
    api["OS-EXT-STS:vm_state"] = (rpc.state ? rpc.state : null);
    //api["OS-EXT-AZ:availability_zone"] = rpc.availability_zone;  // Not sure this can be trusted.
    api.created = rpc.created_at.replace(/\s/g, '').replace(/(\d{4})-(\d{2})-(\d{2})([\d:]+)+.*/, "$1-$2-$3T$4Z");
    api.accessIPv4 = rpc.access_ip_v4;
    api.accessIPv6 = rpc.access_ip_v6;
    api.metadata = rpc.metadata;
    api.flavor = {id: rpc.instance_flavor_id};
    api.image = {id: rpc.image_meta.base_image_ref};
    if (rpc.fixed_ips) {
      api.addresses = {};
      rpc.fixed_ips.forEach(function (ip) {
        if (!api.addresses[ip.label]) api.addresses[ip.label] = [];
        api.addresses[ip.label].push({
          version: ip.version,
          addr: ip.address,
          "OS-EXT-IPS:type": ip.type
        });
        // ip.floating_ips.forEach(function (floating) {});  // Can't get a notification show up when this is populated...
      });
    }
    return api;
  }
});


module.exports = ServerManager;
