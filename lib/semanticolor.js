const Disposable = require('atom').Disposable;
const CompositeDisposable = require('atom').CompositeDisposable;
const SemanticolorGrammarFactory = require('./semanticolor-grammar');
const semanticolorConfig = require('./config');
const utils = require('./utils');

const _ = require('lodash');
const Sugar = require('sugar');
const semver = require('semver');
const debug = require('debug')('semanticolor');

const fs = require('fs');
const path = require('path');

const ATOM_SUPPORTS_TREE_SITTER = semver.satisfies(
	semver.coerce(atom.getVersion()),
	'>=1.52.0'
)

let lessFile = path.join(__dirname, '..', 'styles', 'semanticolor.less');
let grammarListFile = path.join(__dirname, 'grammars.txt');
let ignoredFileTypes = ['md', 'sh', 'cmd', 'bat', 'diff', 'Dockerfile', 'json'];
let forceIncludeFileTypes = ['php', 'html', 'xml', 'xsd', 'vue', 'mjml', 'jsp'];

let grammars = {};
let treeSitterGrammars = {};
let config = {
	colorOptions: {
		description: 'Options that affect how colors are generated.',
		type: 'object',
		order: 0,
		properties: {
			hues: {
				type: 'integer',
				title: 'hues',
				description: 'Fewer colors may make them easier to distinguish, but they will be repeated more often.',
				minimum: 8,
				'default': 700,
				maximum: 700,
				order: 1,
			},
			saturation: {
				type: 'number',
				title: 'saturation',
				description: 'Color saturation (0 to 100%).',
				minimum: 0.1,
				'default': 90,
				maximum: 100,
				order: 2,
			},
			luminosity: {
				type: 'number',
				title: 'luminosity',
				description: 'Color luminosity (0 to 100%).',
				minimum: 0.1,
				'default': 50,
				maximum: 100,
				order: 3,
			},
			fade: {
				type: 'number',
				title: 'fade',
				description: 'Color fade (0 to 100%).',
				minimum: 0.1,
				'default': 40,
				maximum: 100,
				order: 4,
			},
		},
	},
	defaults: Object.assign({ order: 1 }, semanticolorConfig.base),
};

let grammarSet;
try {
	grammarSet = new Set(Sugar.Array.compact(fs.readFileSync(grammarListFile, { encoding: 'utf-8' })
		.split(/\r\n|\r|\n/), true));
} catch (e) {
	grammarSet = new Set();
}

for (let item of grammarSet) {
	addGrammarToConfig(item);
}

function getGrammarName(grammar) {
	let result = grammar.name + ' (' + grammar.packageName + ')'
		+ (utils.isTreeSitter(grammar) ? ' - tree-sitter' : ' - TextMate');
	return result;
}

function getGrammarParamNameFromGrammarName(grammarName) {
	return grammarName && grammarName.replace(/\./g, '_');
}

function extractPackageNameFromParamName(paramName) {
	try {
		let match = paramName && paramName.match(/\(([^\)]+)\)/);
		return match && match[1];
	} catch (__) {}
	return undefined;
}

function addGrammarToConfig(grammarName) {
	let options = Sugar.Object.clone(semanticolorConfig.empty);
	options.title = grammarName;
	config[getGrammarParamNameFromGrammarName(grammarName)] = options;
}

function removeGrammarFromConfig(paramName, cfg) {
	if (config[paramName]) {
		grammarSet.delete(config[paramName].title);
		delete config[paramName];
	}
	if (cfg[paramName]) {
		delete cfg[paramName];
	}
}

function writeGrammarListFile() {
	let fileContents = '';
	for (let item of grammarSet) {
		fileContents += item + '\n';
	}
	fs.writeFileSync(grammarListFile, fileContents, { encoding: 'utf-8' });
}

let defaults = {};

function getOptions(options) {
	let selector = {};
	if (options) {
		for (let key in options) {
			let scope = key.replace(/_/g, '.');
			selector[scope] = options[key];
		}
	}
	return selector;
}

function enable(editor) {
	let grammar = editor.getGrammar();
	if (grammar.packageName === SemanticolorGrammarFactory.packageName) {
		grammar = grammar.__proto__;
	}
	let paramName = getGrammarParamNameFromGrammarName(getGrammarName(grammar));
	grammar = editor.getGrammar();
	let newGrammar = paramName && grammars[paramName];
	let cfg = atom.config.get('semanticolor');
	if (atom.config.get('core.useTreeSitterParsers') && treeSitterGrammars[grammar.scopeName]) {
		newGrammar = treeSitterGrammars[grammar.scopeName];
	}
	if (newGrammar && grammar !== newGrammar && !Semanticolor.deactivated
		&& cfg && cfg[paramName] && cfg[paramName].enabled) {
		debug('using', newGrammar.description, '- ' + editor.getTitle());
		editor.setGrammar(newGrammar);
		if (!Semanticolor.observers.get(editor)) {
			let disposable = editor.observeGrammar(() => enable(editor));
			Semanticolor.observers.set(editor, disposable);
			Semanticolor.disposables.add(disposable);
		}
	}
}

let Semanticolor = {
	config,
	observers: new Map(),
	disposables: new CompositeDisposable(),
	updateLessStylesheet: function () {
		let cfg = atom.config.get('semanticolor').colorOptions;
		let less = makeLess(cfg.hues, cfg.saturation, cfg.luminosity, cfg.fade);
		let written = false;
		try {
			let currentLess = fs.readFileSync(lessFile, { encoding: 'utf-8' });
			if (currentLess !== less) {
				fs.writeFileSync(lessFile, less, { encoding: 'utf-8' });
				written = true;
			}
			if (written) {
				atom.notifications.addSuccess('Rewrote new colors...', { detail: 'Reloading with stylesheet of ' + cfg.hues + ' possible colors.' });
			}
		} catch (e) {
			atom.notifications.addError('No initial colors configured...', {
				detail: 'Updating stylesheet with default of ' + this.config.colorOptions.hues.default +
					' possible colors.',
			});
			try {
				less = makeLess(this.config.colorOptions.hues.default, this.config.colorOptions.saturation.default,
					this.config.colorOptions.luminosity.default, this.config.colorOptions.fade.default);
				written = fs.writeFileSync(lessFile, less, { encoding: 'utf-8' });
			} catch (err) {
				debug('', err);
				atom.notifications.addError(e.code + ' : ' + e.message, { detail: 'Something failed. Open an issue with me!' });
			}
		}

		debug('update LESS', 'written', written);

		return written;

		function makeLess(hues, saturation, luminosity, fade) {
			return '@hues: ' + hues + ';\n' +
				'@saturation: ' + saturation + '%;\n' +
				'@luminosity: ' + luminosity + '%;\n' +
				'@fade: ' + fade + '%;';
		}
	},
	activate: function () {
		this.updateLessStylesheet(true);
		this.deactivated = false;
		let cfg = atom.config.get('semanticolor');
		for (let key in cfg) {
			if (key === 'colorOptions') {
				continue;
			}
			for (let scope in cfg[key]) {
				if (!semanticolorConfig.empty.properties[scope]) {
					delete cfg[key][scope];
				}
			}
		}
		atom.config.set('semanticolor', cfg);

		// detect missing grammars and remove from config
		setTimeout(() => {
			let currentGrammars = {};
			atom.grammars.forEachGrammar(g => {
				if (g.packageName === SemanticolorGrammarFactory.packageName) {
					g = g.__proto__;
				}
				currentGrammars[getGrammarParamNameFromGrammarName(getGrammarName(g))] = g;
			});

			let cfg = atom.config.get('semanticolor');
			let dead = [];
			for (let key in cfg) {
				if (key === 'colorOptions' || key === 'defaults') {
					continue;
				}
				if (!currentGrammars[key]) {
					let packageName = extractPackageNameFromParamName(key);
					if (!packageName) {
						dead.push(key);
					} else if (!atom.packages.isPackageDisabled(packageName)) {
						dead.push(key);
					}
				} else if (!isSupportedGrammar(currentGrammars[key])) {
					dead.push(key);
				}
			}
			if (dead.length) {
				debug('cleanup', 'removing', dead, currentGrammars);
				for (let key of dead) {
					removeGrammarFromConfig(key, cfg);
				}
				writeGrammarListFile();
				atom.config.set('semanticolor', cfg);
			} else {
				debug('cleanup', 'no dead configs found', currentGrammars);
			}
		}, 30000);

		atom.grammars.forEachGrammar(createGrammar);
		if (ATOM_SUPPORTS_TREE_SITTER) {
			// handle not being able to register for an event when new Tree Sitter grammars are added
			setTimeout(() => _.values(atom.grammars.treeSitterGrammarsById).forEach(createGrammar), 5000);
			setTimeout(() => _.values(atom.grammars.treeSitterGrammarsById).forEach(createGrammar), 10000);
			setTimeout(() => _.values(atom.grammars.treeSitterGrammarsById).forEach(createGrammar), 15000);
			setTimeout(() => _.values(atom.grammars.treeSitterGrammarsById).forEach(createGrammar), 20000);
		}
		atom.grammars.onDidAddGrammar(grammar => {
			// Don't bother on unload
			if (!atom.workspace) {
				return;
			}

			createGrammar(grammar);
		});

		this.disposables.add(atom.workspace.observeTextEditors(enable));

		this.disposables.add(atom.config.onDidChange('semanticolor', change => {
			if (Semanticolor.deactivated) {
				return;
			}
			_.debounce(function () {
				Semanticolor.updateLessStylesheet(change.newValue.colorOptions.hues === change.oldValue.colorOptions.hues);
				let reload = !Sugar.Object.isEqual(change.newValue.colorOptions.hues, change.oldValue.colorOptions.hues);
				for (let prop in change.newValue) {
					if (prop !== 'colorOptions' &&
						!Sugar.Object.isEqual(change.newValue[prop], change.oldValue[prop])) {
						reload = true;
						break;
					}
				}
				if (reload) {
					setTimeout(Semanticolor.reload);
				}
			}, 1000)();
		}));

		// local functions
		function createGrammar(grammar) {
			if (utils.isTreeSitter(grammar) && !ATOM_SUPPORTS_TREE_SITTER) {
				return;
			}

			let paramName = tryAddGrammarToConfig(grammar);
			let options;
			if (paramName && cfg[paramName] && cfg[paramName].enabled) {
				options = getOptions(cfg[paramName]);
			} else if (paramName && !cfg[paramName]) {
				options = defaults;
			}
			if (options && !grammars[paramName]) {
				let newGrammar = SemanticolorGrammarFactory.create(grammar, getOptions(cfg.defaults), options,
					cfg.colorOptions.hues);
				grammars[paramName] = newGrammar;
				if (utils.isTreeSitter(newGrammar)) {
					treeSitterGrammars[newGrammar.scopeName] = newGrammar;
				}
				// Activate grammar on existing text editors with matching grammar
				atom.workspace.getTextEditors()
					.filter(editor => editor.getGrammar().scopeName === newGrammar.scopeName)
					.forEach(enable);
			}
			let g = grammars[paramName];
			if (g) {
				debug('registering', g.description, g.scopeName);
				let disposable = atom.grammars.addGrammar(g);
				if (utils.isTreeSitter(g)) {
					Semanticolor.disposables.add(new Disposable(() => atom.grammars.addGrammar(g.__proto__)));
				} else {
					Semanticolor.disposables.add(disposable);
				}
			}
		}

		function tryAddGrammarToConfig(grammar) {
			let grammarName = getGrammarName(grammar);
			let supported = isSupportedGrammar(grammar);
			let inGrammarSet = grammarSet.has(grammarName);

			if (inGrammarSet && supported) {
				return getGrammarParamNameFromGrammarName(grammarName);
			} else if (inGrammarSet) {
				grammarSet.delete(grammarName);
				writeGrammarListFile();
				debug('removing', grammar.description, grammar);
				setTimeout(Semanticolor.reload);
				return null;
			}

			if (supported) {
				grammarSet.add(grammarName);
				writeGrammarListFile();
				addGrammarToConfig(grammarName);
				debug('adding', grammar.description, grammar);
				setTimeout(Semanticolor.reload);
				return getGrammarParamNameFromGrammarName(grammarName);
			}
			return null;
		}

		function isSupportedGrammar(grammar) {
			let result = false;
			if (grammar.packageName === SemanticolorGrammarFactory.packageName) {
				return result;
			}
			if (grammar.name && !grammar.scopeName.includes('null-grammar')
				&& (!utils.isTreeSitter(grammar) || ATOM_SUPPORTS_TREE_SITTER)
				&& ((grammar.scopeName.includes('source') && grammar.fileTypes && grammar.fileTypes.length
				&& Sugar.Array.intersect(grammar.fileTypes, ignoredFileTypes).length === 0)
				|| (grammar.fileTypes && Sugar.Array.intersect(grammar.fileTypes, forceIncludeFileTypes).length > 0))) {
				result = true;
			}
			return result;
		}
	},
	reload: function () {
		if (this.deactivated) {
			return;
		}
		let cfg = atom.config.get('semanticolor');
		defaults = getOptions(cfg.defaults);
		for (let prop in cfg) {
			if (prop !== 'colorOptions' && prop !== 'defaults' && grammars[prop]) {
				grammars[prop].defaults = defaults;
				grammars[prop].options = getOptions(cfg[prop]);
				grammars[prop].colorDiversity = cfg.colorOptions.hues;
				for (let editor of atom.workspace.getTextEditors()) {
					let grammar = editor.getGrammar();
					if (grammar === grammars[prop]) {
						editor.setGrammar(grammar.__proto__);
					}
					if (!this.deactivated && cfg[prop] && cfg[prop].enabled) {
						enable(editor);
					}
				}
			}
		}
	},
	deactivate: function () {
		this.deactivated = true;
		let disposable = this.disposables;
		this.observers = new Map();
		this.disposables = new CompositeDisposable();
		atom.workspace.getTextEditors()
			.forEach(editor => {
				let grammar = editor.getGrammar();
				if (grammar.packageName === SemanticolorGrammarFactory.packageName) {
					editor.setGrammar(grammar.__proto__);
				}
			});
		return disposable.dispose();
	},
};

module.exports = Semanticolor;
