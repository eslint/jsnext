---
applyTo: '**/*.ts, **/*.js, **/*.astro, **/*.tsx, **/*.jsx'
---

# JavaScript/TypeScript Coding Style Guide

For Astro files, the following applies only to the JavaScript/TypeScript code within the files.

## Indentation

Use tabs for indentation.

## Strings

Use double quotes for strings. Example:
<incorrect_code>
```typescript
const message = 'Hello, world!';
```
</incorrect_code>

<correct_code>
```typescript
const message = "Hello, world!";
```
</correct_code>

## Variable and Function Naming

Use camelCase for variable and function names. Example:

<incorrect_code>
```typescript
const my_variable = "value";
```
</incorrect_code>

<correct_code>
```typescript
const myVariable = "value";
```
</correct_code>

Exception: If the variable represents a "magic value", use UPPER_SNAKE_CASE. Example:

<incorrect_code>
```typescript
const myConstant = "value";
```
</incorrect_code>

<correct_code>
```typescript
const MY_CONSTANT = "value";
```
</correct_code>

Exception: If the variable directly represents a database or API field, use snake_case. Example:

<incorrect_code>
```typescript
const userId = "12345";
```
</incorrect_code>

<correct_code>
```typescript
const user_id = "12345";
```
</correct_code>

Variable names should be descriptive and meaningful. Avoid using single-letter variable names except for loop indices or when the context is very clear.

## Conditional Statements

For conditional statements, always use indented blocks. Example:

<incorrect_code>
```typescript
if (condition) return;
```
</incorrect_code>

<correct_code>
```typescript
if (condition) {
	// do something
} else {
	// do something else
}
```
</correct_code>

Always include one blank line before and after a block statement. Example:

<incorrect_code>
```typescript
doSomething();
if (condition) {
	// do something
}
callFunction();
```
</incorrect_code>

<correct_code>
```typescript
doSomething();

if (condition) {
	// do something
}

callFunction();
```
</correct_code>

## JSDoc

Use JSDoc comments for all public functions, classes, and methods. Ensure that the comments are clear and provide useful information about the parameters, return values, and any exceptions that may be thrown. Example:

```typescript
/**
 * Adds two numbers together.
 * @param a The first number.
 * @param b The second number.
 * @returns The sum of the two numbers.
 * @throws {Error} If either parameter is not a number.
 */
function add(a: number, b: number): number {
	if (typeof a !== "number" || typeof b !== "number") {
		throw new Error("Both parameters must be numbers.");
	}
	
  	return a + b;
}
```

Note:
- `@returns` should describe the purpose of the return value, not its type.
- Use `@throws` to document any exceptions that the function may throw, including the conditions under which they are thrown. Use the actual error type if applicable, or `Error` if a generic error is thrown.

IMPORTANT: Whenever you change the parameters or return value of a function, you must update the JSDoc comment to reflect these changes. This ensures that the documentation remains accurate and helpful for anyone using or maintaining the code.

## Comments

When adding comments, ensure they are clear and concise. Use single-line comments (`//`) for brief explanations and multi-line comments (`/* ... */`) for longer descriptions. Always ensure comments are relevant to the code they describe.

Multi-line comments must always have one empty line before the comment block. Example:

```typescript
// Incorrect
function doSomething() {
	/*
	 * This function does something.
	 */
	console.log("Doing something");
}

// Correct
function doSomething() {
	
	/*
	 * This function does something.
	 */
	console.log("Doing something");
}
```

Single-line comments should also have one empty line before them. Example:

```typescript
// Incorrect
function doSomething() {
	// This is a comment.
	console.log("Doing something");
}

// Correct
function doSomething() {
	
	// This is a comment.
	console.log("Doing something");
}
```

Do not use multiple single-line comments in a row. Instead, use a multi-line comment if you need to comment multiple lines of code. Example:

```typescript
// Incorrect
function doSomething() {
	
	// This is a comment.
	// This is another comment.
	console.log("Doing something");
}

// Correct
function doSomething() {
	
	/*
	 * This is a comment.
	 * This is another comment.
	 */
	console.log("Doing something");
}
```

## Supabase Integration

When making changes related to Supabase, you must review all existing migration files in the `supabase/migrations` directory. Ensure that your changes are compatible with the current database schema and do not conflict with existing migrations.

## npm Packages

When using npm packages, do not make up any exports or imports. Instead, find the packages in `node_modules` directory and use both the package’s types (or their equivalent `@types/<package name>` package when it does not ship with types) and the package’s source files to find out what methods and other symbols are available and how they work.

If `node_modules` does not exist in the current directory, then look for it in the root of the workspace.

If you cannot find the package in `node_modules`, do not guess what it might contain. Instead, fetch the package details from `https://npmjs.com/package/<package name>` and use the documentation there to determine what methods and other symbols are available and how they work.

## URL Parsing

When parsing URLs, use `URL.parse()` to ensure the URL is valid instead of `new URL()`. If the URL is malformed, log an error and handle it gracefully. Example:

```typescript
// incorrect
try {
  const parsedUrl = new URL(url);
} catch (error) {
  console.error("Invalid URL:", url);
  // Handle error
}

// correct
const parsedUrl = URL.parse(url);
if (!parsedUrl) {
  console.error("Invalid URL:", url);
  // Handle error
}
```

## Comments

When commenting code, use single-line comments (`//`) for brief explanations and multi-line comments (`/* ... */`) for longer descriptions. Always ensure comments are clear and concise.

Preserve all existing comments when making changes to the code. If you need to modify a comment, ensure that it accurately reflects the current state of the code. Existing comments must never be deleted unless they are no longer relevant or accurate.

## Classes

### Private Fields and Methods

Use the `#` syntax for private fields and methods in classes. Example:

```typescript
class MyClass {
	#privateField: string;

	constructor() {
		this.#privateField = "secret";
	}

	#privateMethod() {
		console.log("This is a private method");
	}

	publicMethod() {
		this.#privateMethod();
		console.log(this.#privateField);
	}
}
