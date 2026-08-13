# Performance Tips

The code in this repository is meant to be as fast as possible while being correct.

Here are some tips on how to make the TypeScript code as fast as possible:

- Use mathematical and binary operations instead of boolean and string operations.
- Avoid string comparisons.
- Avoid creating temporary or intermediate objects.
- Avoid creating arrays with indeterminate lengths.
- Use arrow functions over function declarations/expressions where `this` is not referenced.
- Use array buffers and bit masks.
- Limit conditional branching. No condition is faster than any condition.
- Aim for monomorphic functions.
- When unsure, check V8 compilation to see what the actual compiled representation is.
- Memoize the result of expensive calculations for reuse.
- Use lookup tables (`Map` or `Set`) where appropriate.
