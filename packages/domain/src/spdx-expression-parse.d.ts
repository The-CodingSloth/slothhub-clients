declare module 'spdx-expression-parse' {
  type SpdxExpressionNode =
    | { license: string; plus?: boolean; exception?: string }
    | {
        conjunction: 'and' | 'or'
        left: SpdxExpressionNode
        right: SpdxExpressionNode
      }

  export default function parseSpdxExpression(
    expression: string,
  ): SpdxExpressionNode
}
