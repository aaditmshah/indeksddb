import {
  Annotation,
  FieldDefinition,
  TypeNode,
  TypeReferenceNode,
  SyntaxKind,
  TextLocation,
  Token,
  DatabaseSchema,
  DatabaseDefinition,
  TableDefinition,
  TypeDefinition,
  StringLiteral,
} from './types';

import * as factory from '../factory';
import { createStringLiteral } from '../factory';

export interface Parser {
  parse(): DatabaseSchema;
  synchronize(): void;
}

function isStartOfDefinition(token: Token): boolean {
  switch (token.kind) {
    case 'DatabaseKeyword':
    case 'TableKeyword':
    case 'TypeKeyword':
      return true;

    default:
      return false;
  }
}

class ParseError extends Error {
  public message: string;
  public loc: TextLocation;
  constructor(msg: string, loc: TextLocation) {
    super(msg);
    this.message = msg;
    this.loc = loc;
  }
}

export function createParser(tokens: Array<Token>): Parser {
  let comments: Array<Comment> = [];
  let currentIndex: number = 0;

  // PUBLIC
  function parse(): DatabaseSchema {
    const body: Array<DatabaseDefinition | TypeDefinition> = [];

    while (!isAtEnd()) {
      const def = parseDefinition();
      if (def !== null) {
        body.push(def);
      }
    }

    return factory.createDatabaseSchema(body);
  }

  // Finds the beginning of the next statement so we can continue parse after error.
  function synchronize(): void {
    while (!isAtEnd() && !isStartOfDefinition(currentToken())) {
      advance();
    }
  }

  function parseDefinition(): DatabaseDefinition | TypeDefinition | null {
    const next: Token = currentToken();

    switch (next.kind) {
      case 'DatabaseKeyword':
        return parseDatabaseDefinition();

      case 'TypeKeyword':
        return parseTypeDefinition();

      // case SyntaxType.CommentBlock:
      // case SyntaxType.CommentLine:
      //   consumeComments();
      //   return null;

      default:
        throw reportError(`Invalid start to Database definition ${next.text}`);
    }
  }

  // DatabaseDefinition → 'database' Identifier '{' TableDefinition* '}'
  function parseDatabaseDefinition(): DatabaseDefinition {
    const _keywordToken: Token | null = consume('DatabaseKeyword');
    const keywordToken: Token = requireValue(
      _keywordToken,
      `Unable to find database keyword for database`,
    );
    const _nameToken: Token | null = consume('Identifier');
    const nameToken: Token = requireValue(
      _nameToken,
      `Unable to find identifier for database`,
    );

    const openBrace: Token | null = consume('LeftBraceToken');
    requireValue(openBrace, `Expected opening curly brace`);

    const tables: Array<TableDefinition> = parseTableDefinitions();

    const _closeBrace: Token | null = consume('RightBraceToken');
    const closeBrace = requireValue(
      _closeBrace,
      `Expected closing curly brace`,
    );

    const location: TextLocation = factory.createTextLocation(
      keywordToken.loc.start,
      closeBrace.loc.end,
    );

    return factory.createDatabaseDefinition(
      factory.createIdentifier(nameToken.text, nameToken.loc),
      tables,
      location,
    );
  }

  function parseTableDefinitions(): Array<TableDefinition> {
    const tables: Array<TableDefinition> = [];

    while (!check('RightBraceToken')) {
      tables.push(parseTableDefinition());

      if (check('DatabaseKeyword')) {
        throw reportError(
          `Closing curly brace expected, but new database found`,
        );
      } else if (check('EOF')) {
        throw reportError(
          `Closing curly brace expected but reached end of file`,
        );
      }
    }

    return tables;
  }

  function parseTableDefinition(): TableDefinition {
    const _keywordToken: Token | null = consume('TableKeyword');
    const keywordToken: Token = requireValue(
      _keywordToken,
      `Unable to find table keyword for table`,
    );
    const _nameToken: Token | null = consume('Identifier');
    const nameToken: Token = requireValue(
      _nameToken,
      `Unable to find identifier for table`,
    );

    const annotations = parseAnnotations();

    const _openBrace: Token | null = consume('LeftBraceToken');
    requireValue(_openBrace, `Expected opening curly brace`);

    const fields: Array<FieldDefinition> = parseFields();

    const _closeBrace: Token | null = consume('RightBraceToken');
    const closeBrace = requireValue(
      _closeBrace,
      `Expected closing curly brace`,
    );

    const location: TextLocation = factory.createTextLocation(
      keywordToken.loc.start,
      closeBrace.loc.end,
    );

    return factory.createTableDefinition(
      factory.createIdentifier(nameToken.text, nameToken.loc),
      fields,
      annotations,
      location,
    );
  }

  // TypeDefinition → 'type ' Identifier '=' TypeNode ('|' TypeNode)* ';'
  function parseTypeDefinition(): TypeDefinition {
    const _keywordToken: Token | null = consume('TypeKeyword');
    const keywordToken: Token = requireValue(
      _keywordToken,
      `Unable to find type keyword for type`,
    );
    const _nameToken: Token | null = consume('Identifier');
    const nameToken: Token = requireValue(
      _nameToken,
      `Unable to find identifier for type`,
    );

    const equalToken: Token | null = consume('EqualToken');
    requireValue(equalToken, `Expected '='`);

    const body: ReadonlyArray<TypeNode> = parseTypeNodes();

    const _semicolon: Token | null = consume('SemicolonToken');
    const semicolon: Token = requireValue(
      _semicolon,
      'Field definition should end with semicolon',
    );

    const endLoc: TextLocation = semicolon.loc;
    const location: TextLocation = factory.createTextLocation(
      keywordToken.loc.start,
      endLoc.end,
    );

    return factory.createTypeDefinition(
      factory.createIdentifier(nameToken.text, nameToken.loc),
      body,
      location,
    );
  }

  function parseAnnotations(): ReadonlyArray<Annotation> {
    const annotations: Array<Annotation> = [];

    while (check('AtToken')) {
      const annotation = parseAnnotation();
      if (annotation) {
        annotations.push(annotation);
      }
    }

    return annotations;
  }

  // ListSeparator → ','
  function readListSeparator(): Token | null {
    if (check('CommaToken')) {
      return advance();
    }

    return null;
  }

  // Annotation → '@' Identifier
  function parseAnnotation(): Annotation | null {
    const _atToken: Token | null = consume('AtToken');
    const atToken: Token = requireValue(
      _atToken,
      `Unable to find identifier for field`,
    );

    const nameToken: Token = requireValue(
      consume('Identifier'),
      `Annotation must have a name`,
    );

    const args = parseAnnotationArgs();

    return factory.createAnnotation(
      factory.createIdentifier(nameToken.text, nameToken.loc),
      args,
      factory.createTextLocation(atToken.loc.start, nameToken.loc.end),
    );
  }

  function parseAnnotationArgs(): ReadonlyArray<StringLiteral> {
    const args: Array<StringLiteral> = [];
    const openParen: Token | null = consume('LeftParenToken');
    if (openParen == null) {
      return args;
    }

    while (!check('RightParenToken')) {
      readListSeparator();
      const arg = consume('StringLiteral');
      if (arg) {
        args.push(createStringLiteral(arg.text, arg.loc));
      }

      if (isStartOfDefinition(currentToken())) {
        throw reportError(
          `Closing paren ')' expected, but new definition found`,
        );
      } else if (check('EOF')) {
        throw reportError(`Closing paren ')' expected but reached end of file`);
      }
    }

    consume('RightParenToken');

    return args;
  }

  function parseFields(): Array<FieldDefinition> {
    const fields: Array<FieldDefinition> = [];

    while (!check('RightBraceToken')) {
      fields.push(parseField());

      if (isStartOfDefinition(currentToken())) {
        throw reportError(
          `Closing curly brace expected, but new statement found`,
        );
      } else if (check('EOF')) {
        throw reportError(
          `Closing curly brace expected but reached end of file`,
        );
      }
    }

    return fields;
  }

  // Field → ?Annotation Identifier ':' TypeNode ';'
  function parseField(): FieldDefinition {
    const startLoc: TextLocation = currentToken().loc;
    const annotations: ReadonlyArray<Annotation> = parseAnnotations();
    const _nameToken: Token | null = consume('Identifier');
    const nameToken: Token = requireValue(
      _nameToken,
      `Unable to find identifier for field`,
    );

    const colonToken: Token | null = consume('ColonToken');
    requireValue(colonToken, 'Type annotation expected for field');

    const type: TypeNode = parseTypeNode();
    const _semicolon: Token | null = consume('SemicolonToken');
    const semicolon: Token = requireValue(
      _semicolon,
      'Field definition should end with semicolon',
    );

    const endLoc: TextLocation = semicolon.loc;

    const location: TextLocation = factory.createTextLocation(
      startLoc.start,
      endLoc.end,
    );

    return factory.createFieldDefinition(
      factory.createIdentifier(nameToken.text, nameToken.loc),
      annotations,
      type,
      location,
    );
  }

  function parseTypeNodes(): ReadonlyArray<TypeNode> {
    const typeNodes: Array<TypeNode> = [];

    while (!check('SemicolonToken')) {
      typeNodes.push(parseTypeNode());
      consume('PipeToken');

      if (isStartOfDefinition(currentToken())) {
        throw reportError(
          `Closing semicolon expected, but new statement found`,
        );
      } else if (check('EOF')) {
        throw reportError(`Closing semicolon expected but reached end of file`);
      }
    }

    return typeNodes;
  }

  // TypeNode → Identifier | BaseType | ContainerType
  function parseTypeNode(): TypeNode {
    const typeToken: Token = currentToken();
    switch (typeToken.kind) {
      case 'Identifier':
        return parseTypeReferenceNode();

      case 'BooleanKeyword':
      case 'StringKeyword':
      case 'NumberKeyword':
        advance();
        return factory.createKeywordFieldType(typeToken.kind, typeToken.loc);

      case 'StringLiteral':
        advance();
        return factory.createStringLiteral(typeToken.text, typeToken.loc);
      case 'IntegerLiteral':
        advance();
        return factory.createIntegerLiteral(typeToken.text, typeToken.loc);
      case 'FloatLiteral':
        advance();
        return factory.createFloatLiteral(typeToken.text, typeToken.loc);
      case 'TrueKeyword':
        advance();
        return factory.createBooleanLiteral(true, typeToken.loc);
      case 'FalseKeyword':
        advance();
        return factory.createBooleanLiteral(false, typeToken.loc);

      default:
        throw reportError(`TypeNode expected but found: ${typeToken.kind}`);
    }
  }

  // TypeReferenceNode → Identifier('<' TypeNode (',' TypeNode)* '>')*
  function parseTypeReferenceNode(): TypeReferenceNode {
    const _nameToken: Token | null = consume('Identifier');
    const nameToken: Token = requireValue(
      _nameToken,
      `Unable to find identifier for field`,
    );

    let endToken: Token = nameToken;
    const openBracket: Token | null = consume('LessThanToken');
    const typeArgs: Array<TypeNode> = [];
    if (openBracket != null) {
      while (!check('GreaterThanToken')) {
        const typeArg: TypeNode = parseTypeNode();
        typeArgs.push(typeArg);

        if (check('GreaterThanToken')) {
          const commaToken: Token | null = consume('GreaterThanToken');
          requireValue(
            commaToken,
            `Type variables must be separated by a comma`,
          );
        }
      }

      const _closeBracket: Token | null = consume('GreaterThanToken');
      const closeBracket: Token = requireValue(
        _closeBracket,
        `Map needs to defined contained types`,
      );
      endToken = closeBracket;
    }

    const location: TextLocation = {
      start: nameToken.loc.start,
      end: endToken.loc.end,
    };

    return factory.createTypeReferenceNode(
      factory.createIdentifier(nameToken.text, nameToken.loc),
      typeArgs,
      location,
    );
  }

  function currentToken(): Token {
    // consumeComments();
    return tokens[currentIndex];
  }

  function previousToken(): Token {
    return tokens[currentIndex - 1];
  }

  function peek(): Token {
    return tokens[currentIndex + 1];
  }

  // Does the current token match the given type
  function check(...types: ReadonlyArray<SyntaxKind>): boolean {
    for (const type of types) {
      if (type === currentToken().kind) {
        return true;
      }
    }

    return false;
  }

  // // Does the current token match the given text
  // function checkText(...strs: Array<string>): boolean {
  //   for (const str of strs) {
  //     if (str === currentToken().text) {
  //       return true;
  //     }
  //   }

  //   return false;
  // }

  // requireToken the current token to match given type and advance, otherwise return null
  function consume(...types: ReadonlyArray<SyntaxKind>): Token | null {
    for (const type of types) {
      if (check(type)) {
        return advance();
      }
    }

    return null;
  }

  // Move the cursor forward and return the previous token
  function advance(): Token {
    if (!isAtEnd()) {
      currentIndex += 1;
    }

    return previousToken();
  }

  function isAtEnd(): boolean {
    return currentIndex >= tokens.length || currentToken().kind === 'EOF';
  }

  // function getComments(): Array<Comment> {
  //   const current: Array<Comment> = comments;
  //   comments = [];
  //   return current;
  // }

  function reportError(msg: string): Error {
    return new ParseError(msg, currentToken().loc);
  }

  // Throw if the given value doesn't exist.
  function requireValue<T>(val: T | null, msg: string): T {
    if (val === null || val === undefined) {
      throw reportError(msg);
    } else {
      return val;
    }
  }

  return {
    parse,
    synchronize,
  };
}
