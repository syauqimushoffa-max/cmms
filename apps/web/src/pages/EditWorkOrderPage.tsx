import { AlertCircle, ArrowLeft, CalendarDays, Factory, Save, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { MasterData, ShiftGroup, WorkOrderDepartment, WorkOrderPriority, WorkOrderType } from "@pbs-cmms/shared";
import { workOrderDepartments, workOrderTypeLabels } from "@pbs-cmms/shared";
import { api } from "../api/client";
import { SearchableSelect } from "../components/SearchableSelect";
import { useCurrentUser } from "../state/UserContext";

const priorityOptions: WorkOrderPriority[] = ["low", "medium", "high", "critical"];
const otherOptionValue = "__other__";
const initialForm = {
  number: "",
  type: "maintenance" as WorkOrderType,
  priority: "medium" as WorkOrderPriority,
  dueDate: "",
  workDate: "",
  shiftGroup: "A" as ShiftGroup,
  sectionId: "",
  machineId: "",
  customMachineName: "",
  customArea: "",
  reportedByName: "",
  reportedByDepartment: "",
  responsibleDepartment: "Production" as WorkOrderDepartment,
  issueCategoryId: "",
  customIssueCategory: "",
  issueDescription: ""
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function EditWorkOrderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useCurrentUser();
  const [masterData, setMasterData] = useState<MasterData>({ sections: [], machines: [], issueCategories: [] });
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canEdit = Boolean(currentUser && ["executive", "admin"].includes(currentUser.role));

  useEffect(() => {
    if (!id || !canEdit) {
      setLoading(false);
      return;
    }

    Promise.all([api.workOrder(id), api.masterData()])
      .then(([workOrder, nextMasterData]) => {
        setMasterData(nextMasterData);
        setForm({
          number: workOrder.number,
          type: workOrder.type,
          priority: workOrder.priority,
          dueDate: workOrder.dueDate || "",
          workDate: workOrder.workDate,
          shiftGroup: workOrder.shiftGroup,
          sectionId: workOrder.sectionId || "",
          machineId: workOrder.machineId || "",
          customMachineName: workOrder.machineId ? "" : workOrder.machineName,
          customArea: workOrder.area,
          reportedByName: workOrder.reportedByName,
          reportedByDepartment: workOrder.reportedByDepartment,
          responsibleDepartment: workOrder.responsibleDepartment,
          issueCategoryId: workOrder.issueCategoryId || otherOptionValue,
          customIssueCategory: workOrder.issueCategoryId ? "" : workOrder.issueCategoryName === "Other" ? "" : workOrder.issueCategoryName,
          issueDescription: workOrder.issueDescription
        });
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Unable to load this work order."))
      .finally(() => setLoading(false));
  }, [canEdit, id]);

  const activeSections = useMemo(
    () => masterData.sections.filter((section) => section.department === form.responsibleDepartment && (section.active || section.id === form.sectionId)),
    [form.responsibleDepartment, form.sectionId, masterData.sections]
  );
  const filteredMachines = useMemo(
    () => masterData.machines.filter((machine) => machine.department === form.responsibleDepartment && (machine.active || machine.id === form.machineId) && machine.sectionId === form.sectionId),
    [form.machineId, form.responsibleDepartment, form.sectionId, masterData.machines]
  );
  const issueCategories = useMemo(
    () => masterData.issueCategories.filter((category) => category.department === form.responsibleDepartment && (category.active || category.id === form.issueCategoryId)),
    [form.issueCategoryId, form.responsibleDepartment, masterData.issueCategories]
  );
  const sectionOptions = useMemo(
    () => [{ value: "", label: "No section / office" }, ...activeSections.map((section) => ({ value: section.id, label: section.name }))],
    [activeSections]
  );
  const machineOptions = useMemo(
    () => [{ value: "", label: "Other / unregistered", meta: "Enter the name below" }, ...filteredMachines.map((machine) => ({ value: machine.id, label: machine.name, meta: machine.area }))],
    [filteredMachines]
  );
  const issueCategoryOptions = useMemo(
    () => [...issueCategories.map((category) => ({ value: category.id, label: category.name })), { value: otherOptionValue, label: "Others" }],
    [issueCategories]
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!id || !currentUser || !canEdit) return;

    const selectedMachine = filteredMachines.find((machine) => machine.id === form.machineId);
    const machineName = selectedMachine?.name || form.customMachineName.trim();
    if (!machineName) {
      setError("Enter the machine, equipment, or place name.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.updateWorkOrder(id, {
        actorId: currentUser.id,
        type: form.type,
        priority: form.priority,
        dueDate: form.dueDate || null,
        workDate: form.workDate,
        shiftGroup: form.responsibleDepartment === "Production" ? form.shiftGroup : "N/A",
        sectionId: form.sectionId || null,
        machineId: selectedMachine?.id || null,
        area: selectedMachine?.area || form.customArea.trim() || "General",
        machineName,
        reportedByName: form.reportedByName,
        reportedByDepartment: form.reportedByDepartment,
        responsibleDepartment: form.responsibleDepartment,
        issueCategoryId: form.issueCategoryId === otherOptionValue ? null : form.issueCategoryId || null,
        issueCategoryName: form.issueCategoryId === otherOptionValue ? form.customIssueCategory.trim() || "Other" : issueCategories.find((category) => category.id === form.issueCategoryId)?.name,
        issueDescription: form.issueDescription
      });
      navigate(`/work-orders/${id}`, { replace: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save this work order.");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return <Navigate to={id ? `/work-orders/${id}` : "/work-orders"} replace />;
  }
  if (loading) {
    return <p className="quiet-line">Loading work order editor...</p>;
  }

  return (
    <section className="page-stack work-order-edit-page">
      <div className="page-title-row page-title-clean">
        <div>
          <p className="eyebrow">Controlled update</p>
          <h1>Edit Work Order</h1>
          <span className="edit-work-order-number">{form.number}</span>
        </div>
        <Link className="secondary-action" to={id ? `/work-orders/${id}` : "/work-orders"}>
          <ArrowLeft size={17} aria-hidden="true" />
          Cancel
        </Link>
      </div>

      <div className="edit-permission-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Executive and admin control</strong>
          <span>The original work-order number and activity history stay unchanged.</span>
        </div>
      </div>

      <form className="form-panel work-order-edit-form" onSubmit={handleSubmit}>
        <div className="form-grid three-columns">
          <label>
            Work order type
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as WorkOrderType })}>
              {Object.entries(workOrderTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as WorkOrderPriority })}>
              {priorityOptions.map((priority) => <option key={priority} value={priority}>{titleCase(priority)}</option>)}
            </select>
          </label>
          <label>
            <CalendarDays size={15} aria-hidden="true" />
            Work date
            <input type="date" value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required />
          </label>
          <label>
            Due date
            <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
          </label>
          {form.responsibleDepartment === "Production" ? (
            <label>
              Shift group
              <select value={form.shiftGroup} onChange={(event) => setForm({ ...form, shiftGroup: event.target.value as ShiftGroup })}>
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="form-grid two-columns">
          <SearchableSelect
            label="Section"
            icon={<Factory size={15} aria-hidden="true" />}
            value={form.sectionId}
            options={sectionOptions}
            placeholder="Search section"
            onChange={(sectionId) => setForm({ ...form, sectionId, machineId: "", customMachineName: "", customArea: "" })}
          />
          <SearchableSelect
            label="Machine / equipment"
            value={form.machineId}
            options={machineOptions}
            placeholder="Search machine"
            onChange={(machineId) => setForm({ ...form, machineId, customMachineName: "", customArea: "" })}
          />
        </div>

        {!form.machineId ? (
          <div className="form-grid two-columns">
            <label>
              Machine, equipment, or place
              <input value={form.customMachineName} onChange={(event) => setForm({ ...form, customMachineName: event.target.value })} required />
            </label>
            <label>
              Area
              <input value={form.customArea} onChange={(event) => setForm({ ...form, customArea: event.target.value })} placeholder="General" />
            </label>
          </div>
        ) : null}

        <div className="form-grid two-columns">
          <label>
            Responsible department
            <select value={form.responsibleDepartment} onChange={(event) => setForm({ ...form, responsibleDepartment: event.target.value as WorkOrderDepartment, sectionId: "", machineId: "", customMachineName: "", customArea: "", issueCategoryId: "", customIssueCategory: "" })}>
              {workOrderDepartments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </label>
          <label>
            <UserRound size={15} aria-hidden="true" />
            Reported by
            <input value={form.reportedByName} onChange={(event) => setForm({ ...form, reportedByName: event.target.value })} required />
          </label>
          <label>
            Reported by department
            <select value={form.reportedByDepartment} onChange={(event) => setForm({ ...form, reportedByDepartment: event.target.value })} required>
              <option value="">Choose department</option>
              {form.reportedByDepartment && !workOrderDepartments.includes(form.reportedByDepartment as WorkOrderDepartment)
                ? <option value={form.reportedByDepartment}>{form.reportedByDepartment}</option>
                : null}
              {workOrderDepartments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </label>
        </div>

        <SearchableSelect
          label="Issue category"
          value={form.issueCategoryId}
          options={issueCategoryOptions}
          placeholder="Search category"
          onChange={(issueCategoryId) => setForm({ ...form, issueCategoryId, customIssueCategory: "" })}
        />
        {form.issueCategoryId === otherOptionValue ? <label>Specify issue category<input value={form.customIssueCategory} onChange={(event) => setForm({ ...form, customIssueCategory: event.target.value })} required /></label> : null}

        <label>
          Issue description
          <textarea value={form.issueDescription} onChange={(event) => setForm({ ...form, issueDescription: event.target.value })} rows={6} required />
        </label>

        {error ? <p className="error-line edit-error-line"><AlertCircle size={16} />{error}</p> : null}
        <div className="form-actions work-order-edit-actions">
          <Link className="secondary-action" to={id ? `/work-orders/${id}` : "/work-orders"}>Cancel</Link>
          <button className="primary-action" type="submit" disabled={saving}>
            <Save size={17} aria-hidden="true" />
            {saving ? "Saving changes..." : "Save Changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
