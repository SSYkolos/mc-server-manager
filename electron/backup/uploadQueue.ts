type Job = () => Promise<void>

export async function runUploadQueue(
  jobs: Job[],
  workers: number
) {

  const queue = [...jobs]

  const running: Promise<void>[] = []

  async function worker() {

    while (queue.length > 0) {

      const job = queue.shift()

      if (!job) return

      await job()

    }

  }

  for (let i = 0; i < workers; i++) {

    running.push(worker())

  }

  await Promise.all(running)

}
