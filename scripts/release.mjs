#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { assertExpectedBranch, hasCommitChanges, isExplicitConfirmation, normalizeCommitMessage } from './release-helpers.mjs'

const EXPECTED_BRANCH = 'main'

function heading(message) {
  output.write(`\n=== ${message} ===\n`)
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (capture && result.stderr) output.write(result.stderr)
    throw new Error(`Command failed (${result.status ?? 'unknown'}): ${command} ${args.join(' ')}`)
  }
  return capture ? String(result.stdout || '').trim() : ''
}

async function release() {
  heading('Release preflight')
  const branch = assertExpectedBranch(run('git', ['branch', '--show-current'], { capture: true }), EXPECTED_BRANCH)
  if (!hasCommitChanges(run('git', ['status', '--porcelain'], { capture: true }))) {
    throw new Error('There are no working-tree changes to commit. Nothing to release.')
  }
  output.write(`Branch confirmed: ${branch}\n`)

  heading('Pending Supabase migrations (dry run)')
  run('npx', ['supabase', 'db', 'push', '--dry-run'])
  output.write('\nReview the pending migration output above carefully.\n')

  const prompts = createInterface({ input, output })
  try {
    const approval = await prompts.question('Continue and allow the later remote Supabase database push? Type yes to continue: ')
    if (!isExplicitConfirmation(approval)) throw new Error('Release cancelled before remote database changes.')

    heading('Safety checks')
    run('npm', ['test'])
    run('npm', ['run', 'build'])
    run('npx', ['wrangler', 'deploy', '--dry-run'])
    run('git', ['diff', '--check'])

    const commitMessage = normalizeCommitMessage(await prompts.question('\nGit commit message: '))
    assertExpectedBranch(run('git', ['branch', '--show-current'], { capture: true }), EXPECTED_BRANCH)
    if (!hasCommitChanges(run('git', ['status', '--porcelain'], { capture: true }))) throw new Error('There are no changes left to commit. Release aborted cleanly.')

    heading('Applying approved Supabase migrations')
    run('npx', ['supabase', 'db', 'push'])

    heading('Verifying Supabase migration state')
    run('npx', ['supabase', 'migration', 'list'])

    heading('Committing and pushing application release')
    run('git', ['add', '.'])
    run('git', ['commit', '-m', commitMessage])
    run('git', ['push'])

    heading('Release complete')
    output.write(`Database migrations applied and verified.\nGit commit pushed from ${branch}.\nCloudflare production deployment was not run locally; the GitHub push will trigger it.\n`)
  } finally {
    prompts.close()
  }
}

release().catch(error => {
  output.write(`\nRELEASE ABORTED: ${error.message}\n`)
  process.exitCode = 1
})
