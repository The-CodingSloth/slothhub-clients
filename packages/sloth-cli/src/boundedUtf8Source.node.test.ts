import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vite-plus/test'

import {
  BoundedUtf8SourceError,
  createBoundedUtf8SourceReader,
} from '@slothhub/domain/bounded-utf8-source'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})),
  )
})

const options = {
  maxBytes: 4,
  label: 'Workspace dependency manifest',
  recovery: 'Provide a smaller package.json.',
}

describe('bounded UTF-8 source', () => {
  it('applies the same incremental byte limit to files and stdin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-bounded-source-'))
    directories.push(directory)
    const exactPath = join(directory, 'exact.json')
    const oversizedPath = join(directory, 'oversized.json')
    await writeFile(exactPath, '1234')
    await writeFile(oversizedPath, '12345')
    const stdin = createBoundedUtf8SourceReader({
      stdin: (async function* () {
        yield Buffer.from('1234')
        yield Buffer.from('5')
      })(),
    })
    const files = createBoundedUtf8SourceReader()

    await expect(files(exactPath, options)).resolves.toBe('1234')
    await expect(files(oversizedPath, options)).rejects.toMatchObject({
      code: 'input_too_large',
      configuredLimitBytes: 4,
      observedBytes: 5,
      recovery: options.recovery,
    })
    await expect(stdin('-', options)).rejects.toMatchObject({
      code: 'input_too_large',
      configuredLimitBytes: 4,
      observedBytes: 5,
    })
  })

  it('rejects invalid UTF-8, directories, and symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-bounded-source-'))
    directories.push(directory)
    const target = join(directory, 'target.json')
    const link = join(directory, 'link.json')
    const invalid = join(directory, 'invalid.json')
    await writeFile(target, '{}')
    await symlink(target, link)
    await writeFile(invalid, Buffer.from([0xc3, 0x28]))
    const reader = createBoundedUtf8SourceReader()

    await expect(reader(directory, {...options, maxBytes: 64})).rejects.toMatchObject({
      code: 'source_not_regular',
    })
    await expect(reader(link, {...options, maxBytes: 64})).rejects.toMatchObject({
      code: 'source_not_regular',
    })
    await expect(reader(invalid, {...options, maxBytes: 64})).rejects.toMatchObject({
      code: 'invalid_utf8',
    })
  })

  it('names every reachable constraint and recovery path', () => {
    const error = new BoundedUtf8SourceError(
      'input_too_large',
      'Workspace dependency manifest',
      options.recovery,
      {configuredLimitBytes: 4, observedBytes: 5},
    )

    expect(error.message).toContain('configured limit: 4 bytes')
    expect(error.message).toContain('observed: 5 bytes')
    expect(error.message).toContain(options.recovery)
  })

  it('fails closed on symlinks and path replacement without O_NOFOLLOW', async () => {
    const openSymlink = vi.fn()
    const symlinkReader = createBoundedUtf8SourceReader({
      noFollowFlag: undefined,
      lstat: async () => ({
        isFile: () => false,
        isSymbolicLink: () => true,
        dev: 1,
        ino: 1,
      }),
      open: openSymlink,
    })
    await expect(symlinkReader('link.json', options)).rejects.toMatchObject({
      code: 'source_not_regular',
    })
    expect(openSymlink).not.toHaveBeenCalled()

    const close = vi.fn(async () => {})
    const replacedReader = createBoundedUtf8SourceReader({
      noFollowFlag: undefined,
      lstat: async () => ({isFile: () => true, dev: 1, ino: 1}),
      open: async () => ({
        stat: async () => ({isFile: () => true, dev: 1, ino: 2}),
        read: async () => ({bytesRead: 0}),
        close,
      }),
    })
    await expect(replacedReader('replaced.json', options)).rejects.toMatchObject({
      code: 'source_not_regular',
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('accepts a regular file when the platform leaves the lstat device unreported', async () => {
    // Windows lstat reports dev 0 while the opened file reports the real device.
    let reads = 0
    const reader = createBoundedUtf8SourceReader({
      noFollowFlag: undefined,
      lstat: async () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        dev: 0,
        ino: 7,
      }),
      open: async () => ({
        stat: async () => ({isFile: () => true, dev: 241002834, ino: 7}),
        read: async (buffer: Buffer) => {
          if (reads > 0) return {bytesRead: 0}
          reads += 1
          buffer.set(Buffer.from('1234'))
          return {bytesRead: 4}
        },
        close: async () => {},
      }),
    })

    await expect(reader('artifact.json', options)).resolves.toBe('1234')
  })

  it('still rejects a cross-device replacement when both devices are reported', async () => {
    const close = vi.fn(async () => {})
    const reader = createBoundedUtf8SourceReader({
      noFollowFlag: undefined,
      lstat: async () => ({isFile: () => true, dev: 1, ino: 7}),
      open: async () => ({
        stat: async () => ({isFile: () => true, dev: 2, ino: 7}),
        read: async () => ({bytesRead: 0}),
        close,
      }),
    })

    await expect(reader('replaced.json', options)).rejects.toMatchObject({
      code: 'source_not_regular',
    })
    expect(close).toHaveBeenCalledOnce()
  })
})
