import {isRuntimeFunction} from '@slothhub/domain/runtime-validation'
import {vi} from 'vite-plus/test'

type ModuleFakeFunction = (
  ...arguments_: never[]
) => object | string | number | boolean | symbol | bigint | null | undefined | void

type ModuleFakeConstructor = abstract new (...arguments_: never[]) => object

type ModuleFakeReplacement<Value> = Value extends abstract new (...arguments_: never[]) => object
  ? ModuleFakeConstructor
  : Value extends (...arguments_: never[]) => object | string | number | boolean | symbol | bigint | null | undefined | void
    ? ModuleFakeFunction
    : Value extends readonly (infer Item)[]
      ? ReadonlyArray<ModuleFakeReplacement<Item>>
      : Value extends object
        ? {[Key in keyof Value]?: ModuleFakeReplacement<Value[Key]>}
        : Value

type ModuleFakeReplacements<Module extends object> = Partial<{
  [Key in keyof Module]: ModuleFakeReplacement<Module[Key]>
}>

/** Install typed test implementations against a module's real exported interface. */
export const installModuleFakes = <Module extends object>(
  module: Module,
  replacements: ModuleFakeReplacements<Module>,
): void => {
  // SAFETY: Object.keys is bounded to own enumerable replacement keys, each of which belongs to Module.
  const keys = Object.keys(replacements) as Array<Extract<keyof Module, string>>
  for (const key of keys) {
    const original = module[key]
    const replacement = replacements[key]
    if (Object.is(original, replacement)) continue
    if (isRuntimeFunction(original) && isRuntimeFunction(replacement)) {
      // SAFETY: Runtime checks establish that this real module key and replacement are callable.
      vi.spyOn(module, key as never).mockImplementation(replacement as never)
      continue
    }
    // SAFETY: The key comes from Partial<Module>, and the replacement retains that key's value type.
    vi.spyOn(module, key as never, 'get').mockReturnValue(replacement as never)
  }
}
