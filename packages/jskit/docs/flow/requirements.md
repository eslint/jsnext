# Requirements for control flow analysis

## Goal

Create a utility that evaluates the binary AST format from the parser and the binary format from the scope analyzer into a control flow graph.

## Description

This utility is meant to efficiently evaluate JavaScript/TypeScript code in such a way as to provide additional insights into how the code is structured and functions. 

## Control flow graph

ESLint already has a code path analysis system, however, it is buggy and unreliable, and should not be used as the basis for this approach. You may use the TypeScript compiler code flow graph as a comparison to determine correctness.

Create a basic-block control flow graph. To support future type narrowing, basic blocks must record two things clearly:

* Assignments / Variable Writes (updates the type environment).
* Branch Conditions on edges (refines the type environment).

This information must be stored in a compact binary format. It may make references to the scope/symbol information through byte offsets into the `ArrayBuffer` holding the scope information and the `ArrayBuffer` holding the binary AST.

## Public API

- A `createGraph()` function that accepts an array buffer representing a binary AST and an array buffer of scope information. It returns an array buffer containing the control flow graph.
- A `toGraphTree()` function that takes the result of `creaetGraph()` and any other information it needs, and converts it into an object tree for easy debugging and serialization. The returned value must be JSON-serializable. The tree must be fully-self contained without references to external objects.
