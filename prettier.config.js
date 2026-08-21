/**
 * @fileoverview Prettier configuration.
 *
 * Tabs at width 4 and double quotes are what `docs/javascript.md` asks for,
 * and what the existing source already uses, so turning the formatter on does
 * not restyle the codebase out from under anyone. JSON is the exception:
 * `package.json` is rewritten by npm with two-space indentation on every
 * install, so formatting it any other way guarantees a diff after every
 * `npm install`.
 */
export default {
	useTabs: true,
	tabWidth: 4,
	arrowParens: "avoid",

	overrides: [
		{
			files: ["*.json"],
			options: {
				tabWidth: 2,
				useTabs: false,
			},
		},
	],
};
