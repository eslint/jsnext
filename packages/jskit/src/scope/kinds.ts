/**
 * @fileoverview The small enumerations the scope graph is built out of.
 *
 * Scope types, definition types, and reference flags are all spelled exactly
 * as `eslint-scope` and `@typescript-eslint/scope-manager` spell them, because
 * rules written against either one match on these strings.
 */

//-----------------------------------------------------------------------------
// Scope Types
//-----------------------------------------------------------------------------

export const SCOPE_GLOBAL = "global";
export const SCOPE_MODULE = "module";
export const SCOPE_FUNCTION = "function";
export const SCOPE_FUNCTION_EXPRESSION_NAME = "function-expression-name";
export const SCOPE_BLOCK = "block";
export const SCOPE_SWITCH = "switch";
export const SCOPE_CATCH = "catch";
export const SCOPE_WITH = "with";
export const SCOPE_FOR = "for";
export const SCOPE_CLASS = "class";
export const SCOPE_CLASS_FIELD_INITIALIZER = "class-field-initializer";
export const SCOPE_CLASS_STATIC_BLOCK = "class-static-block";

/*
 * The TypeScript-only scope types. `@typescript-eslint/scope-manager` spells
 * these in camelCase while spelling the shared ones in kebab-case; the
 * inconsistency is part of the contract, so it is reproduced here.
 */
export const SCOPE_CONDITIONAL_TYPE = "conditionalType";
export const SCOPE_FUNCTION_TYPE = "functionType";
export const SCOPE_MAPPED_TYPE = "mappedType";
export const SCOPE_TS_ENUM = "tsEnum";
export const SCOPE_TS_MODULE = "tsModule";
export const SCOPE_TYPE = "type";

/** Every scope type, as a union of the string literals. */
export type ScopeType =
	| typeof SCOPE_GLOBAL
	| typeof SCOPE_MODULE
	| typeof SCOPE_FUNCTION
	| typeof SCOPE_FUNCTION_EXPRESSION_NAME
	| typeof SCOPE_BLOCK
	| typeof SCOPE_SWITCH
	| typeof SCOPE_CATCH
	| typeof SCOPE_WITH
	| typeof SCOPE_FOR
	| typeof SCOPE_CLASS
	| typeof SCOPE_CLASS_FIELD_INITIALIZER
	| typeof SCOPE_CLASS_STATIC_BLOCK
	| typeof SCOPE_CONDITIONAL_TYPE
	| typeof SCOPE_FUNCTION_TYPE
	| typeof SCOPE_MAPPED_TYPE
	| typeof SCOPE_TS_ENUM
	| typeof SCOPE_TS_MODULE
	| typeof SCOPE_TYPE;

/**
 * The scope types that `var` declarations climb to, and that therefore act as
 * their own `variableScope`.
 */
const VARIABLE_SCOPE_TYPES = new Set<string>([
	SCOPE_GLOBAL,
	SCOPE_MODULE,
	SCOPE_FUNCTION,
	SCOPE_CLASS_FIELD_INITIALIZER,
	SCOPE_CLASS_STATIC_BLOCK,
	SCOPE_TS_MODULE,
]);

/**
 * Reports whether a scope type stops a `var` declaration from climbing.
 * @param type The scope type.
 * @returns `true` when a scope of this type is its own variable scope.
 */
export function isVariableScopeType(type: ScopeType): boolean {
	return VARIABLE_SCOPE_TYPES.has(type);
}

/**
 * The TypeScript-only scope types that are strict simply by being what they
 * are, the way a class body is.
 */
const IMPLICITLY_STRICT_TYPES = new Set<string>([
	SCOPE_CLASS,
	SCOPE_MODULE,
	SCOPE_CONDITIONAL_TYPE,
	SCOPE_FUNCTION_TYPE,
	SCOPE_MAPPED_TYPE,
	SCOPE_TS_ENUM,
	SCOPE_TS_MODULE,
	SCOPE_TYPE,
]);

/**
 * Reports whether a scope type is always strict regardless of its contents.
 * @param type The scope type.
 * @returns `true` when the scope type implies strict mode.
 */
export function isImplicitlyStrictType(type: ScopeType): boolean {
	return IMPLICITLY_STRICT_TYPES.has(type);
}

//-----------------------------------------------------------------------------
// Definition Types
//-----------------------------------------------------------------------------

export const DEF_CATCH_CLAUSE = "CatchClause";
export const DEF_PARAMETER = "Parameter";
export const DEF_FUNCTION_NAME = "FunctionName";
export const DEF_CLASS_NAME = "ClassName";
export const DEF_VARIABLE = "Variable";
export const DEF_IMPORT_BINDING = "ImportBinding";
export const DEF_IMPLICIT_GLOBAL_VARIABLE = "ImplicitGlobalVariable";
export const DEF_TYPE = "Type";
export const DEF_TS_ENUM_NAME = "TSEnumName";
export const DEF_TS_MODULE_NAME = "TSModuleName";

/**
 * `@typescript-eslint/scope-manager` names this definition type
 * `TSEnumMemberName` even though its enum member is spelled `TSEnumMember`.
 */
export const DEF_TS_ENUM_MEMBER = "TSEnumMemberName";

/** Every definition type, as a union of the string literals. */
export type DefinitionType =
	| typeof DEF_CATCH_CLAUSE
	| typeof DEF_PARAMETER
	| typeof DEF_FUNCTION_NAME
	| typeof DEF_CLASS_NAME
	| typeof DEF_VARIABLE
	| typeof DEF_IMPORT_BINDING
	| typeof DEF_IMPLICIT_GLOBAL_VARIABLE
	| typeof DEF_TYPE
	| typeof DEF_TS_ENUM_NAME
	| typeof DEF_TS_MODULE_NAME
	| typeof DEF_TS_ENUM_MEMBER;

//-----------------------------------------------------------------------------
// Reference Flags
//-----------------------------------------------------------------------------

/** The reference reads the variable. */
export const READ = 1;

/** The reference writes the variable. */
export const WRITE = 2;

/** The reference both reads and writes the variable, as `x += 1` does. */
export const READ_WRITE = READ | WRITE;

/** The reference is to the variable's value. */
export const REF_VALUE = 1;

/** The reference is to the variable's type. */
export const REF_TYPE = 2;

/** The reference is to both, as a bare `export { x }` is. */
export const REF_VALUE_TYPE = REF_VALUE | REF_TYPE;
