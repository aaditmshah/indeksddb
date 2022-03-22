import * as ts from 'typescript';
import { DatabaseDefinition, TableDefinition } from '../../parser';
import { COMMON_IDENTIFIERS } from '../identifiers';
import { getAnnotationsByName } from '../keys';
import { capitalize } from '../utils';
import { createAddMethodTypeNode } from './addMethod';
import { createDatabaseClientName } from './common';
import {
  createGetAllMethodTypeNode,
  createGetMethodTypeNode,
} from './getMethod';

export function createOptionsTypeNode(): ts.TypeNode {
  return ts.factory.createTypeLiteralNode([
    ts.factory.createPropertySignature(
      undefined,
      COMMON_IDENTIFIERS.transaction,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      ts.factory.createTypeReferenceNode(COMMON_IDENTIFIERS.IDBTransaction),
    ),
  ]);
}

export function createOptionsParameterDeclaration(): ts.ParameterDeclaration {
  return ts.factory.createParameterDeclaration(
    undefined,
    undefined,
    undefined,
    ts.factory.createIdentifier('options'),
    ts.factory.createToken(ts.SyntaxKind.QuestionToken),
    createOptionsTypeNode(),
  );
}

export function createClientTypeDeclaration(
  def: DatabaseDefinition,
): ts.TypeAliasDeclaration {
  return ts.factory.createTypeAliasDeclaration(
    undefined,
    [ts.factory.createToken(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createIdentifier(createDatabaseClientName(def)),
    undefined,
    ts.factory.createTypeLiteralNode(
      def.body.map((next) => {
        return ts.factory.createPropertySignature(
          undefined,
          ts.factory.createIdentifier(next.name.value.toLowerCase()),
          undefined,
          ts.factory.createTypeLiteralNode([
            ts.factory.createPropertySignature(
              undefined,
              ts.factory.createIdentifier('add'),
              undefined,
              createAddMethodTypeNode(next),
            ),
            ts.factory.createPropertySignature(
              undefined,
              ts.factory.createIdentifier('get'),
              undefined,
              createGetMethodTypeNode(next),
            ),
            ts.factory.createPropertySignature(
              undefined,
              ts.factory.createIdentifier('getAll'),
              undefined,
              createGetAllMethodTypeNode(next),
            ),
          ]),
        );
      }),
    ),
  );
}

export function getItemNameForTable(def: TableDefinition): string {
  const itemAnnotations = getAnnotationsByName(def.annotations, 'item');
  if (itemAnnotations.length > 1) {
    throw new Error('Table can only include one annotation for "item"');
  }

  const itemArguments = itemAnnotations[0]?.arguments;
  if (itemArguments && itemArguments.length > 1) {
    throw new Error('Table can only include one name alias');
  }

  if (itemArguments && itemArguments.length > 0) {
    return itemArguments[0]?.value;
  }

  return capitalize(def.name.value);
}
