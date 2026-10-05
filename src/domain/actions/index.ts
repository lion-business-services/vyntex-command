// Every change to business data goes through an action here, so the same change always
// writes the same history, updates the same totals and starts the same automations.
// One file per area; everything is re-exported from this file, so pages keep importing from '@/domain/actions'.
export { nextTicket, createLead, updateLead, setLeadStage, deleteLead, convertLead, assignNextLead, handoffLead } from './leads';
export { saveClient, addNote, deleteNote } from './clients';
export { nextJobNumber, createJob, updateJob, setJobStatus, deleteJob, saveAssignment, removeFromJob, addExpense, addClientPayment, addWorkLog } from './jobs';
export { createTask, updateTask, setTaskStatus, toggleTask, deleteTask, createClientRequest, addTaskComment, editTaskComment, deleteTaskComment, reassignTasks } from './tasks';
export { addCashEntry, updateCashEntry, deleteCashEntry, transferCash, approveCashClose, saveDeadline, completeDeadline, setDeadlineStatus, attachDeadlineEvidence, deleteDeadline, importDeadlines } from './ops';
export { saveWorker, payWorker, deleteWorkerPay, saveProfile } from './team';
export { saveOffice, removeOffice, setRolePermissions, resetRole, setRoleLabel, setSecurityRules, setVaultRules } from './security';
export { createDoc, createDocFromTemplate, saveDocEdits, sendForSignature, advanceSignature, setDocStatus, restoreDocVersion, addUpload, addDocVersion, updateDocMeta, saveTemplate, approveTemplate, setTemplateActive, deleteTemplate } from './documents';
export { createEnvelope, saveEnvelope, deleteEnvelope, sendEnvelope, viewEnvelope, signEnvelope, declineEnvelope, voidEnvelope, remindEnvelope, attachSignedCopy, sweepEnvelopes, saveEsignSettings, approveConsent } from './esign';
export { bookAppointment } from './appointments';
export { startPlaybook } from './catalog';
export { queueMessage, updateDraft, sendDraft, discardDraft, receiveMessage, markRead, logCall, setConversation, recordConsent, saveCommsSettings } from './messages';
export { createPost, updatePost, submitPost, approvePost, schedulePost, publishPost, retryPost, unschedulePost, deletePost } from './social';
export { runDaily } from './daily';
export { saveService, duplicateService, setServiceActive, deleteService, moveTier, linkExternalId, importCatalog, savePlaybook, deletePlaybook } from './catalog';
export { rollForward, afterServiceAssigned, fromService } from './jobs';
export { evaluateCrossSell, saveCrossSellRule, deleteCrossSellRule, setCrossSellRuleActive, addOpportunity, setOpportunityStatus, snoozeOpportunity, opportunityToLead, opportunityToEngagement, settleOpportunities } from './opportunities';
export { requestReview, sendReview, openReview, answerReview, declineReview, deleteReview, saveReviewSettings, sweepReviews } from './reviews';
