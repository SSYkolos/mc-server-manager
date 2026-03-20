import { ScannedFile } from "./scanFiles"

export type ClassifiedFiles = {
  small: ScannedFile[]
  medium: ScannedFile[]
  large: ScannedFile[]
}

export function classifyFiles(files: ScannedFile[]): ClassifiedFiles {

  const small: ScannedFile[] = []
  const medium: ScannedFile[] = []
  const large: ScannedFile[] = []

  for (const f of files) {

    if (f.size < 1_000_000) {

      small.push(f)

    } else if (f.size < 64_000_000) {

      medium.push(f)

    } else {

      large.push(f)

    }

  }

  return { small, medium, large }

}