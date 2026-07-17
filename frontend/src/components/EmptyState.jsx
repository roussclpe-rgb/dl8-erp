import PageState from "./PageState";

export default function EmptyState({ icon, title, subtitle, description, actionLabel, onAction }) {
  return (
    <PageState icon={icon} title={title} description={description || subtitle} actionLabel={actionLabel} onAction={onAction} />
  );
}
