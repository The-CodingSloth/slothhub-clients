/** Public GitLab.com project paths may include arbitrarily nested namespaces. */
export const parseGitlabRepositoryUrl = (value: string): string | undefined => {
  const match = /^https:\/\/gitlab\.com\/([^?#]+)\/?$/iu.exec(value)
  if (!match) return undefined
  const path = match[1].replace(/\/$/u, '').replace(/\.git$/iu, '')
  const segments = path.split('/')
  return segments.length >= 2 && segments.every((segment) =>
    /^[a-z0-9_][a-z0-9_.-]*$/iu.test(segment) && segment !== '.' && segment !== '..',
  ) ? path : undefined
}
