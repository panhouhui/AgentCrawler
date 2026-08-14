import { spawn } from 'node:child_process'

export type ExecResult = {
  stdout: string
  stderr: string
  code: number
}

export function execFile(file: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
    child.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }))
  })
}
