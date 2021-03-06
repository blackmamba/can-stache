var live = require('can-view-live');
var nodeLists = require('can-view-nodelist');
var compute = require('can-compute');

var utils = require('../src/utils');

var types = require('can-util/js/types/types');
var isFunction = require('can-util/js/is-function/is-function');

var getBaseURL = require('can-util/js/base-url/base-url');
var joinURIs = require('can-util/js/join-uris/join-uris');

var each = require('can-util/js/each/each');
var assign = require('can-util/js/assign/assign');
var isIterable = require("can-util/js/is-iterable/is-iterable");


var domData = require('can-util/dom/data/data');

var looksLikeOptions = function(options){
	return options && typeof options.fn === "function" && typeof options.inverse === "function";
};

var resolve = function (value) {
	if (isFunction(value)) {
		return value();
	} else {
		return value;
	}
};
var resolveHash = function(hash){
	var params = {};
	for(var prop in hash) {
		var value = hash[prop];
		if(value && value.isComputed) {
			params[prop] = value();
		} else {
			params[prop] = value;
		}
	}
	return params;
};


var helpers = {
	"each": function(items) {
		var args = [].slice.call(arguments),
		    options = args.pop(),
		    argsLen = args.length,
		    argExprs = options.exprData.argExprs,
		    resolved = resolve(items),
		    asVariable,
		    result = [],
		    aliases,
		    keys,
		    key,
		    i;

		if (argsLen === 2 || (argsLen === 3 && argExprs[1].key === 'as')) {
			asVariable = args[argsLen - 1];

			if (typeof asVariable !== 'string') {
				asVariable = argExprs[argsLen - 1].key;
			}
		}

		if (types.isListLike(resolved) && !options.stringOnly) {
			return function(el){
				// make a child nodeList inside the can.view.live.html nodeList
				// so that if the html is re
				var nodeList = [el];
				nodeList.expression = "live.list";
				nodeLists.register(nodeList, null, options.nodeList, true);
				// runs nest replacements
				nodeLists.update(options.nodeList, [el]);

				var cb = function (item, index, parentNodeList) {
					var aliases = {
						"%index": index,
						"@index": index
					};

					if (asVariable) {
						aliases[asVariable] = item;
					}

					return options.fn(options.scope.add(aliases, { notContext: true }).add(item), options.options, parentNodeList);
				};

				live.list(el, items, cb, options.context, el.parentNode, nodeList, function(list, parentNodeList){
					return options.inverse(options.scope.add(list), options.options, parentNodeList);
				});
			};
		}

		var expr = resolved;

		if ( !! expr && utils.isArrayLike(expr)) {
			var isMapLike = types.isMapLike(expr);
			for (i = 0; i < (isMapLike ? expr.attr('length') : expr.length); i++) {
				aliases = {
					"%index": i,
					"@index": i
				};
				var item = isMapLike ? expr.attr(i) : expr[i];

				if (asVariable) {
					aliases[asVariable] = item;
				}

				result.push(options.fn(options.scope.add(aliases, { notContext: true }).add(item)));
			}
		}
		else if(isIterable(expr)) {
			each(expr, function(value, key){
				aliases = {
					"%key": key
				};

				if (asVariable) {
					aliases[asVariable] = value;
				}

				result.push(options.fn(options.scope.add(aliases, { notContext: true}).add(value)));

			});
		}
		else if (types.isMapLike(expr)) {
			keys = expr.constructor.keys(expr);
			// listen to keys changing so we can livebind lists of attributes.

			for (i = 0; i < keys.length; i++) {
				key = keys[i];
				aliases = {
					"%key": key,
					"@key": key
				};

				if (asVariable) {
					aliases[asVariable] = expr[key];
				}

				result.push(options.fn(options.scope.add(aliases, { notContext: true }).add(expr[key])));
			}
		} else if (expr instanceof Object) {
			for (key in expr) {
				aliases = {
					"%key": key,
					"@key": key
				};

				if (asVariable) {
					aliases[asVariable] = expr[key];
				}

				result.push(options.fn(options.scope.add(aliases, { notContext: true }).add(expr[key])));
			}
		}

		return !options.stringOnly ? result : result.join('');
	},
	"@index": function(offset, options) {
		if (!options) {
			options = offset;
			offset = 0;
		}
		var index = options.scope.peak("@index");
		return ""+((isFunction(index) ? index() : index) + offset);
	},
	'if': function (expr, options) {
		var value;
		// if it's a function, wrap its value in a compute
		// that will only change values from true to false
		if (isFunction(expr)) {
			value = compute.truthy(expr)();
		} else {
			value = !! resolve(expr);
		}

		if (value) {
			return options.fn(options.scope || this);
		} else {
			return options.inverse(options.scope || this);
		}
	},
	'is': function() {
		var lastValue, curValue,
		options = arguments[arguments.length - 1];

		if (arguments.length - 2 <= 0) {
			return options.inverse();
		}

		var args = arguments;
		var callFn = compute(function(){
			for (var i = 0; i < args.length - 1; i++) {
				curValue = resolve(args[i]);
				curValue = isFunction(curValue) ? curValue() : curValue;

				if (i > 0) {
					if (curValue !== lastValue) {
						return false;
					}
				}
				lastValue = curValue;
			}
			return true;
		});

		return callFn() ? options.fn() : options.inverse();
	},
	'eq': function() {
		return helpers.is.apply(this, arguments);
	},
	'unless': function (expr, options) {
		return helpers['if'].apply(this, [expr, assign(assign({}, options), {
			fn: options.inverse,
			inverse: options.fn
		})]);
	},
	'with': function (expr, options) {
		var ctx = expr;
		expr = resolve(expr);
		if ( !! expr) {
			return options.fn(ctx);
		}
	},
	'log': function (options) {
		// go through the arguments
		var logs = [];
		each(arguments, function(val){
			if(!looksLikeOptions(val)) {
				logs.push(val)
			}
		});


		if (typeof console !== "undefined" && console.log) {
			if (!logs.length) {
				console.log(options.context);
			} else {
				console.log.apply(console, logs);
			}
		}
	},
	'data': function(attr){
		// options will either be the second or third argument.
		// Get the argument before that.
		var data = arguments.length === 2 ? this : arguments[1];
		return function(el){
			domData.set.call( el, attr, data || this.context );
		};
	},
	'switch': function(expression, options){
		resolve(expression);
		var found = false;
		var newOptions = options.helpers.add({
			"case": function(value, options){
				if(!found && resolve(expression) === resolve(value)) {
					found = true;
					return options.fn(options.scope || this);
				}
			},
			"default": function(options){
				if(!found) {
					return options.fn(options.scope || this);
				}
			}
		});
		return options.fn(options.scope, newOptions);
	},
	'joinBase': function(firstExpr/* , expr... */){
		var args = [].slice.call(arguments);
		var options = args.pop();

		var moduleReference = args.map( function(expr){
			var value = resolve(expr);
			return isFunction(value) ? value() : value;
		}).join("");

		var templateModule = options.helpers.peak("helpers.module");
		var parentAddress = templateModule ? templateModule.uri: undefined;

		var isRelative = moduleReference[0] === ".";

		if(isRelative && parentAddress) {
			return joinURIs(parentAddress, moduleReference);
		} else {
			var baseURL = (typeof System !== "undefined" &&
				(System.renderingLoader && System.renderingLoader.baseURL ||
				System.baseURL)) ||
				getBaseURL();

			// Make sure one of them has a needed /
			if(moduleReference[0] !== "/" && baseURL[baseURL.length - 1] !== "/") {
				baseURL += "/";
			}

			return joinURIs(baseURL, moduleReference);
		}
	}
};

helpers.eachOf = helpers.each;

var registerHelper = function(name, callback){
	helpers[name] = callback;
};

var makeSimpleHelper = function(fn) {
	return function() {
		var realArgs = [];
		each(arguments, function(val, i) {
			if (i <= arguments.length) {
				while (val && val.isComputed) {
					val = val();
				}
				realArgs.push(val);
			}
		});
		return fn.apply(this, realArgs);
	};
};

module.exports = {
	registerHelper: registerHelper,
	registerSimpleHelper: function(name, callback) {
		registerHelper(name, makeSimpleHelper(callback));
	},
	getHelper: function(name, options){

		var helper = options && options.get("helpers." + name,{proxyMethods: false});
		if(!helper) {
			helper = helpers[name];
		}
		if(helper) {
			return {fn: helper};
		}
	},
	resolve: resolve,
	resolveHash: resolveHash,
	looksLikeOptions: looksLikeOptions
};
