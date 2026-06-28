## 1. Data Model And Import Foundation

- [x] 1.1 Add SQLite schema initialization for employees, recruitment targets, interview records, import batches, and required indexes.
- [x] 1.2 Add shared pagination, filter parsing, date parsing, percentage formatting, and sensitive value masking utilities.
- [x] 1.3 Add Excel parsing helpers for required-column validation, row normalization, error summaries, and import result objects.
- [x] 1.4 Add transaction helpers for overwrite and append import modes, including rollback on validation or write failures.

## 2. Employee Data Management

- [x] 2.1 Implement active employee import with full overwrite by active source type.
- [x] 2.2 Implement resigned employee import with full overwrite by resigned source type and field normalization from resigned employee columns.
- [x] 2.3 Implement employee DAO and query service with keyword, base, position, status, channel, date, and pagination filters.
- [x] 2.4 Implement recruiter list page using `职位 = 招聘专员` role filter.
- [x] 2.5 Implement frontline employee list page using centralized frontline position rules.
- [x] 2.6 Verify employee lists show required columns and mask phone numbers by default.

## 3. Recruitment Target Management

- [x] 3.1 Implement monthly target import with `整体目标` sheet validation and overwrite by target month.
- [x] 3.2 Store daily target values from `1日` through `31日` for cutoff target calculation.
- [x] 3.3 Implement target DAO and target list query with month, base, channel, keyword, and pagination filters.
- [x] 3.4 Implement target progress service for monthly target, cutoff target, actual training count, GAP, achievement rate, channel share, and unmatched data.
- [x] 3.5 Implement target list page with progress columns and import modal.
- [x] 3.6 Implement target achievement progress page with overall, base, and channel views.

## 4. Interview Record Management

- [x] 4.1 Implement interview import with historical full overwrite mode.
- [x] 4.2 Implement interview import with daily append mode.
- [x] 4.3 Implement interview import with daily overwrite mode based on `面试官填写反馈时间`.
- [x] 4.4 Implement interview DAO and list query with keyword, feedback date, feedback result, interviewer, channel tag, and pagination filters.
- [x] 4.5 Implement interview record list page with masked phone numbers and import modal.
- [x] 4.6 Implement interview funnel analysis for feedback results, recommended-to-training conversion, and channel-level conversion.

## 5. Platform Layout And Shared Pages

- [x] 5.1 Replace top navigation with collapsible left two-level navigation covering the four business modules.
- [x] 5.2 Add shared EJS partials for filter panels, table action bars, pagination, import modal, metric cards, and empty/error states.
- [x] 5.3 Update route definitions for all employee, target, interview, and dashboard pages.
- [x] 5.4 Preserve old MVP routes with redirects or meaningful compatibility pages.
- [x] 5.5 Add front-end JavaScript for sidebar collapse, import modal submission, query reset, and pagination interactions.

## 6. Recruitment Analytics Dashboard

- [x] 6.1 Implement dashboard service for top metrics: overall target, cutoff target, actual training, GAP, achievement rate, unmet base count, self-sourcing efficiency, and self-sourcing share.
- [x] 6.2 Implement global channel share analysis with fixed channel ordering.
- [x] 6.3 Implement base risk analysis with negative GAP highlighting and top shortage channels.
- [x] 6.4 Implement drill-down data providers for actual training employee details.
- [x] 6.5 Implement self-sourcing efficiency analysis by probation, formal, and overall recruiter stages.
- [x] 6.6 Implement dashboard pages for recruitment overview, base risk, and self-sourcing efficiency.

## 7. Verification

- [x] 7.1 Add focused tests or verification scripts for employee import normalization and overwrite behavior.
- [x] 7.2 Add focused tests or verification scripts for target progress calculations against the provided sample files.
- [x] 7.3 Add focused tests or verification scripts for interview import modes and funnel calculations.
- [x] 7.4 Run the application locally and verify all navigation routes render.
- [x] 7.5 Import the provided active employee, resigned employee, monthly target, and interview record files and verify list counts, pagination, masking, and dashboard metrics.
- [x] 7.6 Run available lint, test, or smoke commands and document any remaining gaps.
