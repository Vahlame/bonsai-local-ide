/** A correct patch and a completed, verified agent task are separate requirements. */
export function veredictoFinal(verdict,events,error,profile){
  const stop=events.findLast(e=>e.type==='done');
  const finished=!error&&stop?.motivo==='completed'&&stop.incompleto===false;
  const hostDone=profile!=='small-local-coder'||events.some(e=>e.type==='agent_trace'&&e.event==='done');
  return {...verdict,patchCorrect:verdict.ok,finished,hostDone,ok:verdict.ok&&finished&&hostDone};
}
