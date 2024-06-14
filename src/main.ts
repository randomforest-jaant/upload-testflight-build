import {getInput, setOutput, setFailed, warning} from '@actions/core'
import {platform} from 'os'
import {installPrivateKey, uploadApp, deleteAllPrivateKeys} from './altool'
import {retry} from 'ts-retry-promise'
import {ExecOptions} from '@actions/exec/lib/interfaces'

async function run(): Promise<void> {
  try {
    if (platform() !== 'darwin') {
      throw new Error('Action requires macOS agent.')
    }

    const issuerId: string = getInput('issuer-id')
    const apiKeyId: string = getInput('api-key-id')
    const apiPrivateKey: string = getInput('api-private-key')
    const appPath: string = getInput('app-path')
    const appType: string = getInput('app-type')
    const retryAttempts: number = parseInt(
      getInput('retry-attempts-on-timeout')
    )
    const retryWaitSeconds: number = parseInt(
      getInput('retry_wait_seconds')
    )

    let output = ''
    const options: ExecOptions = {}
    options.listeners = {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }

    await installPrivateKey(apiKeyId, apiPrivateKey)
    const uploadWithRetry = async (): Promise<void> => {
      try {
        await uploadApp(appPath, appType, apiKeyId, issuerId, options)
      } catch (e) {
        if (output.includes('The request timed out')) {
          throw Error('timeout')
        }

        throw e
      }
    }

    try {
      await retry(uploadWithRetry, {
        retries: retryAttempts,
        delay: retryWaitSeconds * 1000,
        retryIf(error) {
          return error.message === 'timeout'
        }
      })
    } catch (error: unknown | Error) {
      warning(
        `Upload failed after ${retryAttempts} attempts: ${(error as Error).message || 'An unknown error occurred.'}`
      )
      throw error
    }

    await deleteAllPrivateKeys()
    setOutput('altool-response', output)
  } catch (error: unknown | Error) {
    setFailed((error as Error).message || 'An unknown error occurred.')
  }
}

run()
