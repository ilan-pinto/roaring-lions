/**
 * GH-1393: the lazy boundary for Save and Resume. `main.ts` reaches the save library, the store, the shell record, the resume check and
 * the failure copy ONLY through `import('./mission-save-kit')`, so none of it (nor the gzip and snapshot helpers it pulls in) is in the
 * entry chunk's static graph. `webgpu:bundle`'s MAIN CHUNK GUARD went red when slice 2 imported them statically; the wiring test
 * (`mission-resume-wiring.test.ts`) fails if `main.ts` names any of these modules in a static import again.
 */
export { cutMission, restoreMission, sealMission } from './mission-save';
export { discardSuspended, openSuspendStore, readSuspended, savedMissionOtherThan, writeSuspended } from './mission-save-store';
export { captureShell, shellJson } from './mission-shell';
export { clearResumeProblem, loadResume, noteResumeProblem, peekResumeMoved, peekResumeProblem, startInputsJson, type ResumeLoaded } from './mission-resume';
export { saveFailureText } from './ui/resume-copy';
