export function getObjectPath(hash:string){

  const prefix = hash.substring(0,2)

  return {
    folder: prefix,
    name: `${hash}.bin`
  }

}