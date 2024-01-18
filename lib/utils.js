module.exports = {
	isTreeSitter: function (grammar) {
		return (
			grammar.constructor.name === 'TreeSitterGrammar' ||
			grammar.constructor.name === 'WASMTreeSitterGrammar'
		);
	},

	isLegacyTreeSitter(grammar) {
		return grammar.constructor.name === 'TreeSitterGrammar';
	},

	isWasmTreeSitter(grammar) {
		return grammar.constructor.name === 'WASMTreeSitterGrammar';
	},
};
