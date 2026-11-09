// The clock for anything that measures how long something took.
//
// Date.now() is the time of day, and a server can move it: NTP corrections do, and so can a cloud
// VM syncing its clock after being moved to another host. A jump in the middle of a question would
// give a player the wrong time, or end the question early. performance.now() only ever runs
// forward, so this is that clock, started at the time of day so its numbers can still be stored
// next to Date.now() ones.

const startedAt = Date.now() - performance.now();

export const serverNow = () => Math.round(startedAt + performance.now());
