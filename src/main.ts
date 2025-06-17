import {getInput, setOutput, setFailed, warning, info} from '@actions/core'
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
    const retryAttempts: number =
      parseInt(getInput('retry-attempts-on-timeout')) || 0
    const retryWaitSeconds: number =
      parseInt(getInput('retry_wait_seconds')) || 30

    let output = ''
    const options: ExecOptions = {}
    options.listeners = {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }

    await installPrivateKey(apiKeyId, apiPrivateKey)

    let attemptCount = 0
    try {
      const uploadWithRetry = async (): Promise<void> => {
        attemptCount++
        output = '' // Reset output for each retry attempt
        info(`Starting upload attempt ${attemptCount}`)

        try {
          await uploadApp(appPath, appType, apiKeyId, issuerId, options)
          info(`Attempt ${attemptCount} completed successfully`)
        } catch (e) {
          info(`Attempt ${attemptCount} caught error: ${(e as Error).message}`)
          info(
            `Attempt ${attemptCount} altool output: ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`
          )

          // Check if upload actually succeeded despite the error
          if (
            output.includes('UPLOAD SUCCEEDED') ||
            output.includes('<key>success-message</key>')
          ) {
            info(
              `Attempt ${attemptCount} actually succeeded despite error - not retrying`
            )
            return // Upload succeeded, don't retry
          }

          if (output.includes('The request timed out')) {
            info(`Attempt ${attemptCount} timed out - will retry`)
            throw Error('timeout')
          }

          info(
            `Attempt ${attemptCount} failed with non-timeout error - will not retry`
          )
          throw e
        }
      }

      await retry(uploadWithRetry, {
        retries: retryAttempts,
        delay: retryWaitSeconds * 1000,
        retryIf(error) {
          return error.message === 'timeout'
        }
      })
    } catch (error: unknown | Error) {
      info(
        `All retry attempts completed. Final output: ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`
      )

      // Check if upload actually succeeded despite the retry timeout
      if (
        output.includes('UPLOAD SUCCEEDED') ||
        output.includes('<key>success-message</key>')
      ) {
        info(`Upload actually succeeded despite retry failures`)
        setOutput('altool-response', output)
        return // Upload succeeded, don't fail
      }

      info(`Upload truly failed after ${attemptCount} attempts`)
      warning(
        `Upload failed after ${retryAttempts + 1} total attempts: ${(error as Error).message || 'An unknown error occurred.'}`
      )
      throw error
    } finally {
      await deleteAllPrivateKeys()
    }

    setOutput('altool-response', output)
  } catch (error: unknown | Error) {
    setFailed((error as Error).message || 'An unknown error occurred.')
  }
}

run()
