# Changelog

## 0.1.0 (2026-08-28)


### ⚠ BREAKING CHANGES

* Rename the `embedSource` parse option to `source`
* Store tokens in the parse buffer only on request

### Features

* Convert to one package ([d265891](https://github.com/eslint/jsnext/commit/d265891aa9459c028ec0bdb78aa4c4e11f8fd33a))
* Give ESLint the scope graph through parseForESLint() ([f198c7f](https://github.com/eslint/jsnext/commit/f198c7ffd8df1a4e50148eaa7ded3904ac58c2b8))
* Let Scopes queries name a node by its position ([afd978a](https://github.com/eslint/jsnext/commit/afd978a9d88f5bb54bb539cd02f2935370220a0d))
* Record each block's nodes in the flow tree ([e3a0524](https://github.com/eslint/jsnext/commit/e3a05242e7684cdc6d37f47281a5961814ad6ebf))
* Rename the `embedSource` parse option to `source` ([0e21661](https://github.com/eslint/jsnext/commit/0e216610e4e970d1a13f0721b596ccd6477f1572))
* Rust core ([86ce198](https://github.com/eslint/jsnext/commit/86ce198f286cf3ca14941b4b9d35819859b53029))
* Store tokens in the parse buffer only on request ([73669ca](https://github.com/eslint/jsnext/commit/73669cafc2680e7fb56fee6eeec47946dc63293e))
* Type inspection ([5130609](https://github.com/eslint/jsnext/commit/5130609206cfaec2371aac38d72e03e644ade052))


### Bug Fixes

* A few bugs ([d005816](https://github.com/eslint/jsnext/commit/d0058166001b822633aa9a890124f2df231d7b70))
* Add readCount/writeCount to scope variables ([a8b6a0b](https://github.com/eslint/jsnext/commit/a8b6a0bd0a5a2fdd07280f59e3e382439ad257a6))
* End a legacy octal literal at its last octal digit ([0bc0669](https://github.com/eslint/jsnext/commit/0bc066945b7873775fb4484d9a54bd65a9edced2))
* End the `for` head's ban on `in` at a function boundary ([ca41b9f](https://github.com/eslint/jsnext/commit/ca41b9fa4658718d6a3a5272e7d111b30d31ccdf))
* Give a function node to the block that evaluates it ([7b3dc10](https://github.com/eslint/jsnext/commit/7b3dc103fa999931d675f88b665e525f81097d90))
* Let a class accessor's name sit on the next line ([0156b63](https://github.com/eslint/jsnext/commit/0156b630376b9e8dd61ffde9908d656a3564b5b4))
* Pass text when not embedded ([6a6ab89](https://github.com/eslint/jsnext/commit/6a6ab89330cb582f476aefcccf9b68760e18ac8d))
* Private names validation ([4958067](https://github.com/eslint/jsnext/commit/4958067983d0019b6ac3b8727fabcea460e7a324))
* Read a slash that starts a statement as a regular expression ([8cfdf3f](https://github.com/eslint/jsnext/commit/8cfdf3ff55d429f56e9843f81c0f5dcba352fa17))
* Separate validation from toAst ([6b6db9a](https://github.com/eslint/jsnext/commit/6b6db9a01499179325c88b07e7028c39ca15dc65))
* Stop reading a parenthesized string as a directive ([6e1b7cb](https://github.com/eslint/jsnext/commit/6e1b7cbd1ea657c63e15a9c06b5064d0b4505dc5))
* Take a function type's arrow from the next line ([4ffe11c](https://github.com/eslint/jsnext/commit/4ffe11ce2d2f56f9d6686ce82e85821028b89b35))


### Performance Improvements

* Drop repeated pairs from the node-block index ([f5c904b](https://github.com/eslint/jsnext/commit/f5c904b91a4275648fcb498d8064f34cd5e793d4))
* Rust-based validate ([7b64563](https://github.com/eslint/jsnext/commit/7b64563f6c777b69e3a1857467131f74ff4b355e))
* Speed improvements ([c415d04](https://github.com/eslint/jsnext/commit/c415d04dcd1ca3492cac96c4d82c3ad5fd13a77d))
* Speed up line calculation ([3bd63a1](https://github.com/eslint/jsnext/commit/3bd63a151133aedf77ad9208164e26951c598154))
* Speed up validate by 20% ([1f76de8](https://github.com/eslint/jsnext/commit/1f76de8a130cde8d5238731795e072eca8801a4a))
* Speed up validation ([cb2fdbd](https://github.com/eslint/jsnext/commit/cb2fdbd2a54822b67f0f0dd120cd59df0fc9026f))


### Dependencies

* The following workspace dependencies were updated
  * optionalDependencies
    * @eslint/jskit-native bumped from 0.0.0 to 0.1.0
