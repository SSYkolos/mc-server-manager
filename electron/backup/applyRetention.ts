export function applyRetention(snapshots:string[],limit:number){

  if(snapshots.length <= limit) return []

  snapshots.sort()

  return snapshots.slice(0,snapshots.length-limit)

}