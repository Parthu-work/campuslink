// One lazily loaded module for every G12 screen (prompt 2): a single import on the boot path
// (bundle budget). Members, employers and the platform each open only their own screens.
export { NetworkPage } from './network';
export { NetworkAdmin } from './network-admin';
export { RecruiterPage, RecruiterPostingPage } from '../recruiter/recruiter';
export { EmployerApplyPage } from '../recruiter/employer-apply';
export { PlatformEmployers } from '../recruiter/platform-employers';
