// Database triggers make the change marker atomic with every device/import write.
// The marker uses existing settings tables, so old accounts and credentials stay put.
export function syncSchema(prefix="") {
  if(!/^(?:u\d+_)?$/.test(prefix))throw new Error("Invalid sync prefix");
  const settings=prefix+"settings",bump=`INSERT INTO ${settings}(key,value) VALUES ('sync_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1;`;
  const statements=[`INSERT OR IGNORE INTO ${settings}(key,value) VALUES ('sync_revision','0');`];
  for(const table of ["tasks","axes","files"])for(const event of ["INSERT","UPDATE","DELETE"])
    statements.push(`CREATE TRIGGER IF NOT EXISTS ${prefix}sync_${table}_${event.toLowerCase()} AFTER ${event} ON ${prefix}${table} BEGIN ${bump} END;`);
  for(const event of ["INSERT","UPDATE","DELETE"])
    statements.push(`CREATE TRIGGER IF NOT EXISTS ${prefix}sync_sources_${event.toLowerCase()} AFTER ${event} ON ${prefix}sources${event==="UPDATE"?" WHEN OLD.error IS NOT NEW.error OR OLD.task_count IS NOT NEW.task_count":""} BEGIN ${bump} END;`);
  for(const event of ["INSERT","UPDATE","DELETE"]){
    const row=event==="DELETE"?"OLD":"NEW";
    const tracked=`(${row}.key IN ('axis_layout','source_links','visual_effects') OR ${row}.key LIKE 'focus:%' OR ${row}.key LIKE 'quadrant:%' OR ${row}.key LIKE 'timetable:%')`;
    statements.push(`CREATE TRIGGER IF NOT EXISTS ${prefix}sync_settings_${event.toLowerCase()} AFTER ${event} ON ${settings} WHEN ${tracked}${event==="UPDATE"?" AND OLD.value IS NOT NEW.value":""} BEGIN ${bump} END;`);
  }
  return statements.join("\n");
}
