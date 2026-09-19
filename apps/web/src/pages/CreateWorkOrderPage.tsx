import { ArrowLeft, CalendarDays, Factory, Send, UserRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { MasterData, ShiftGroup, WorkOrderDepartment, WorkOrderType } from "@pbs-cmms/shared";
import { workOrderDepartmentForUser, workOrderDepartments, workOrderFormRulesForDepartment, workOrderTypeLabels } from "@pbs-cmms/shared";
import { api } from "../api/client";
import { SearchableSelect } from "../components/SearchableSelect";
import { MultiPhotoPicker } from "../components/MultiPhotoPicker";
import { useCurrentUser } from "../state/UserContext";

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const initialForm = {
  type: "maintenance" as WorkOrderType,
  workDate: todayDate(),
  shiftGroup: "A" as ShiftGroup,
  sectionId: "",
  customSection: "",
  area: "",
  customArea: "",
  machineId: "",
  customMachineName: "",
  reportedByName: "",
  reportedByDepartment: "",
  customReportedByDepartment: "",
  responsibleDepartment: "Production" as WorkOrderDepartment,
  issueCategoryId: "",
  customIssueCategory: "",
  issueDescription: ""
};

const otherOptionValue = "__other__";

function reporterDepartmentOptions(current: string) {
  return current && current !== otherOptionValue && !workOrderDepartments.some((department) => department === current)
    ? [current, ...workOrderDepartments]
    : workOrderDepartments;
}

export function CreateWorkOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const assetFromQuery = searchParams.get("asset")?.trim() || "";
  const { currentUser } = useCurrentUser();
  const [masterData, setMasterData] = useState<MasterData>({ sections: [], machines: [], issueCategories: [] });
  const [form, setForm] = useState(() => ({ ...initialForm, workDate: todayDate() }));
  const [masterReady, setMasterReady] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [issueFiles, setIssueFiles] = useState<File[]>([]);

  useEffect(() => {
    api.masterData()
      .then((nextMasterData) => {
        setMasterData(nextMasterData);
        setMasterReady(true);
        setForm((current) => {
          const responsibleDepartment = workOrderDepartmentForUser(currentUser?.department || "") || current.responsibleDepartment;
          return {
            ...current,
            sectionId: current.sectionId || nextMasterData.sections.find((section) => section.active && section.department === responsibleDepartment)?.id || "",
            issueCategoryId: current.issueCategoryId || nextMasterData.issueCategories.find((category) => category.active && category.department === responsibleDepartment)?.id || "",
            customMachineName: current.customMachineName || assetFromQuery,
            reportedByName: current.reportedByName || currentUser?.name || "",
            reportedByDepartment: current.reportedByDepartment || currentUser?.department || "",
            responsibleDepartment
          };
        });
      })
      .catch(() => setError("Couldn’t load sections and machines. Reload this page before submitting."));
  }, [assetFromQuery, currentUser?.department, currentUser?.name]);

  const activeSections = useMemo(() => masterData.sections.filter((section) => section.active && section.department === form.responsibleDepartment), [form.responsibleDepartment, masterData.sections]);
  const activeIssueCategories = useMemo(() => masterData.issueCategories.filter((category) => category.active && category.department === form.responsibleDepartment), [form.responsibleDepartment, masterData.issueCategories]);
  const rules = workOrderFormRulesForDepartment(form.responsibleDepartment);
  const areaOptions = useMemo(() => {
    const areas = [...new Set(masterData.machines
      .filter((machine) => machine.active && machine.department === form.responsibleDepartment && (!form.sectionId || form.sectionId === otherOptionValue || machine.sectionId === form.sectionId))
      .map((machine) => machine.area).filter(Boolean))];
    return [...areas.map((area) => ({ value: area, label: area })), { value: otherOptionValue, label: "Others", meta: "Specify an area" }];
  }, [form.responsibleDepartment, form.sectionId, masterData.machines]);
  const filteredMachines = useMemo(() => {
    return masterData.machines.filter((machine) => machine.active && machine.department === form.responsibleDepartment && machine.sectionId === form.sectionId && (!form.area || form.area === otherOptionValue || machine.area === form.area));
  }, [form.area, form.responsibleDepartment, masterData.machines, form.sectionId]);
  const sectionOptions = useMemo(() => [...activeSections.map((section) => ({ value: section.id, label: section.name })), { value: otherOptionValue, label: "Others", meta: "Specify a section" }], [activeSections]);
  const machineOptions = useMemo(
    () => [
      { value: otherOptionValue, label: "Others", meta: "Specify a machine" },
      ...filteredMachines.map((machine) => ({ value: machine.id, label: machine.name, meta: machine.area }))
    ],
    [filteredMachines]
  );
  const issueCategoryOptions = useMemo(
    () => [...activeIssueCategories.map((category) => ({ value: category.id, label: category.name })), { value: otherOptionValue, label: "Others", meta: "Specify an issue category" }],
    [activeIssueCategories]
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || submitting || !masterReady) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const selectedMachine = filteredMachines.find((machine) => machine.id === form.machineId);
      const customMachineName = form.customMachineName.trim();
      if (rules.section === "required" && !form.sectionId) throw new Error("Choose a section or select Others.");
      if (rules.section !== "hidden" && form.sectionId === otherOptionValue && !form.customSection.trim()) throw new Error("Specify the section.");
      if (rules.area === "required" && !form.area) throw new Error("Choose an area or select Others.");
      if (rules.area !== "hidden" && form.area === otherOptionValue && !form.customArea.trim()) throw new Error("Specify the area.");
      if (rules.machine === "required" && !form.machineId) throw new Error("Choose a machine or select Others.");
      if (rules.machine !== "hidden" && form.machineId === otherOptionValue && !customMachineName) throw new Error("Specify the machine or equipment.");
      if (rules.issueCategory === "required" && !form.issueCategoryId) throw new Error("Choose an issue category or select Others.");
      if (rules.issueCategory !== "hidden" && form.issueCategoryId === otherOptionValue && !form.customIssueCategory.trim()) throw new Error("Specify the issue category.");
      if (form.reportedByDepartment === otherOptionValue && !form.customReportedByDepartment.trim()) throw new Error("Specify the reporting department.");
      const workOrder = createdOrderId ? { id: createdOrderId } : await api.createWorkOrder({
        type: form.type,
        requesterId: currentUser.id,
        workDate: form.workDate || todayDate(),
        shiftGroup: form.responsibleDepartment === "Production" ? form.shiftGroup : "N/A",
        sectionId: rules.section === "hidden" || form.sectionId === otherOptionValue ? null : form.sectionId || null,
        location: form.sectionId === otherOptionValue ? form.customSection.trim() : activeSections.find((section) => section.id === form.sectionId)?.name,
        machineId: rules.machine === "hidden" || form.machineId === otherOptionValue ? null : selectedMachine?.id || null,
        area: rules.area === "hidden" ? "Not applicable" : form.area === otherOptionValue ? form.customArea.trim() : form.area || selectedMachine?.area || "General",
        machineName: rules.machine === "hidden" ? "Not applicable" : selectedMachine?.name || customMachineName || "Not specified",
        reportedByName: form.reportedByName,
        reportedByDepartment: form.reportedByDepartment === otherOptionValue ? form.customReportedByDepartment.trim() : form.reportedByDepartment,
        responsibleDepartment: form.responsibleDepartment,
        issueCategoryId: rules.issueCategory === "hidden" || form.issueCategoryId === otherOptionValue ? null : form.issueCategoryId || null,
        issueCategoryName: rules.issueCategory === "hidden" ? "General" : form.issueCategoryId === otherOptionValue ? form.customIssueCategory.trim() : activeIssueCategories.find((category) => category.id === form.issueCategoryId)?.name,
        issueDescription: form.issueDescription
      });
      setCreatedOrderId(workOrder.id);
      if (issueFiles && issueFiles.length > 0) {
        await api.uploadAttachments(workOrder.id, currentUser.id, "issue", issueFiles);
      }
      navigate(`/work-orders/${workOrder.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create work order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (currentUser?.role === "technician") {
    return <Navigate to="/technician" replace />;
  }

  return (
    <section className="page-stack">
      <div className="page-title-row page-title-clean">
        <div>
          <p className="eyebrow">Requester flow</p>
          <h1>New Work Order</h1>
        </div>
        <Link className="secondary-action" to="/work-orders">
          <ArrowLeft size={17} aria-hidden="true" />
          Back
        </Link>
      </div>

      <form className="form-panel" onSubmit={handleSubmit} aria-busy={submitting}>
        <p className="ux-form-help">Describe the issue and where it happened. Photos are optional and help the maintenance team prepare.</p>
        <fieldset className="ux-form-fields" disabled={submitting || Boolean(createdOrderId)}>
        <div className="form-grid two-columns">
          <label>
            Work order type
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as WorkOrderType })}>
              {Object.entries(workOrderTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <CalendarDays size={15} aria-hidden="true" />
            Date
            <input type="date" value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required />
          </label>
        </div>

        <label>
          Responsible department
          <select value={form.responsibleDepartment} onChange={(event) => setForm({ ...form, responsibleDepartment: event.target.value as WorkOrderDepartment, sectionId: "", customSection: "", area: "", customArea: "", machineId: "", customMachineName: "", issueCategoryId: "", customIssueCategory: "" })}>
            {workOrderDepartments.map((department) => <option key={department} value={department}>{department}</option>)}
          </select>
          <small>Section, machine and issue category options are filtered for this department.</small>
        </label>

        <div className={`form-grid ${rules.shiftGroup !== "hidden" ? "three-columns" : "two-columns"}`}>
          {rules.shiftGroup !== "hidden" ? (
            <label>
              Shift group
              <select value={form.shiftGroup} onChange={(event) => setForm({ ...form, shiftGroup: event.target.value as ShiftGroup })}>
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </label>
          ) : null}

          {rules.section !== "hidden" ? <SearchableSelect
            label="Section"
            icon={<Factory size={15} aria-hidden="true" />}
            value={form.sectionId}
            options={sectionOptions}
            placeholder="Choose a section"
            disabled={submitting || Boolean(createdOrderId)}
            onChange={(sectionId) => setForm({ ...form, sectionId, customSection: "", area: "", customArea: "", machineId: "", customMachineName: "" })}
          /> : null}

          {rules.area !== "hidden" ? <SearchableSelect
            label={`Area${rules.area === "optional" ? " (optional)" : ""}`}
            value={form.area}
            options={areaOptions}
            placeholder="Choose an area"
            disabled={submitting || Boolean(createdOrderId)}
            onChange={(area) => setForm({ ...form, area, customArea: "", machineId: "", customMachineName: "" })}
          /> : null}
        </div>

        {rules.section !== "hidden" && form.sectionId === otherOptionValue ? (
          <label>
            Specify section
            <input value={form.customSection} onChange={(event) => setForm({ ...form, customSection: event.target.value })} required />
          </label>
        ) : null}

        {rules.area !== "hidden" && form.area === otherOptionValue ? (
          <label>
            Specify area
            <input value={form.customArea} onChange={(event) => setForm({ ...form, customArea: event.target.value })} required />
          </label>
        ) : null}

        {rules.machine !== "hidden" ? <SearchableSelect
          label={`Machine / equipment${rules.machine === "optional" ? " (optional)" : ""}`}
          value={form.machineId}
          options={machineOptions}
          placeholder="Choose a machine"
          disabled={submitting || Boolean(createdOrderId)}
          onChange={(machineId) => setForm({ ...form, machineId, customMachineName: "" })}
        /> : null}

        {rules.machine !== "hidden" && form.machineId === otherOptionValue ? (
          <label>
            Specify machine or equipment
            <input value={form.customMachineName} onChange={(event) => setForm({ ...form, customMachineName: event.target.value })} required />
          </label>
        ) : null}

        <div className="form-grid two-columns">
          <label>
            <UserRound size={15} aria-hidden="true" />
            Reported by
            <input value={form.reportedByName} onChange={(event) => setForm({ ...form, reportedByName: event.target.value })} required />
          </label>

          <label>
            Reported by department
            <select value={form.reportedByDepartment} onChange={(event) => setForm({ ...form, reportedByDepartment: event.target.value, customReportedByDepartment: "" })} required>
              <option value="">Choose department</option>
              {reporterDepartmentOptions(form.reportedByDepartment).map((department) => <option key={department} value={department}>{department}</option>)}
              <option value={otherOptionValue}>Others</option>
            </select>
          </label>
        </div>

        {form.reportedByDepartment === otherOptionValue ? <label>Specify reporting department<input value={form.customReportedByDepartment} onChange={(event) => setForm({ ...form, customReportedByDepartment: event.target.value })} required /></label> : null}

        {rules.issueCategory !== "hidden" ? <SearchableSelect
          label="Issue category"
          value={form.issueCategoryId}
          options={issueCategoryOptions}
          placeholder="Choose an issue category"
          disabled={submitting || Boolean(createdOrderId)}
          onChange={(issueCategoryId) => setForm({ ...form, issueCategoryId, customIssueCategory: "" })}
        /> : null}
        {rules.issueCategory !== "hidden" && form.issueCategoryId === otherOptionValue ? <label>Specify issue category<input value={form.customIssueCategory} onChange={(event) => setForm({ ...form, customIssueCategory: event.target.value })} required /></label> : null}

        <label>
          Issue description
          <textarea value={form.issueDescription} onChange={(event) => setForm({ ...form, issueDescription: event.target.value })} rows={5} placeholder="What happened? Include symptoms, when it started, and any impact on production." required />
        </label>

        <MultiPhotoPicker
          files={issueFiles}
          onChange={setIssueFiles}
          disabled={submitting}
          help="Choose several issue photos before creating the work order."
        />

        </fieldset>
        {error ? <p className="error-line" role="alert">{createdOrderId ? "Your work order was created, but the photos could not be uploaded. Retry the upload or open the work order to add photos later. " : ""}{error}</p> : null}
        {createdOrderId ? <Link className="secondary-action" to={`/work-orders/${createdOrderId}`}>Open created work order</Link> : null}

        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={submitting || !masterReady}>
            <Send size={17} aria-hidden="true" />
            {submitting ? "Submitting..." : createdOrderId ? "Retry photo upload" : "Create work order"}
          </button>
        </div>
      </form>
    </section>
  );
}
