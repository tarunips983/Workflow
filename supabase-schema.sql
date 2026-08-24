-- OfficeFlow Pro database schema for Supabase
-- Run this entire file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('employee','approver','manager','admin');
create type public.record_status as enum ('draft','in_progress','pending_approval','approved','returned','rejected','completed','cancelled');
create type public.task_status as enum ('todo','in_progress','blocked','done');
create type public.priority_level as enum ('low','normal','high','urgent');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  employee_code text unique,
  designation text,
  department text,
  phone text,
  role public.user_role not null default 'employee',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  department text,
  title text not null,
  reference_no text,
  category text not null default 'office',
  storage_path text,
  mime_type text,
  file_size bigint,
  status public.record_status not null default 'draft',
  version integer not null default 1,
  parent_document_id uuid references public.documents(id) on delete set null,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  department text,
  workflow_type text not null,
  title text not null,
  description text,
  status public.record_status not null default 'draft',
  priority public.priority_level not null default 'normal',
  due_date date,
  amount numeric(14,2),
  reference_no text,
  current_step integer not null default 1,
  total_steps integer not null default 1,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  assignee_id uuid references public.profiles(id) on delete set null,
  department text,
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  priority public.priority_level not null default 'normal',
  due_date date,
  workflow_item_id uuid references public.workflow_items(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workflow_item_id uuid references public.workflow_items(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  approver_id uuid references public.profiles(id) on delete set null,
  status public.record_status not null default 'pending_approval',
  step_no integer not null default 1,
  action_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  signer_id uuid not null references public.profiles(id) on delete restrict,
  signer_name text not null,
  designation text,
  signature_data text not null,
  signature_hash text not null,
  signed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  workflow_item_id uuid references public.workflow_items(id) on delete set null,
  title text not null,
  estimate_type text not null default 'Material + Service',
  note text,
  subtotal numeric(14,2) not null default 0,
  contingency numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  description text not null,
  quantity numeric(14,3) not null default 1,
  unit text not null default 'Nos',
  rate numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * rate) stored
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  workflow_item_id uuid references public.workflow_items(id) on delete set null,
  po_ref text unique,
  pr_ref text,
  vendor_name text,
  description text,
  amount numeric(14,2),
  stage text not null default 'PR',
  due_date date,
  status public.record_status not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advance_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  workflow_item_id uuid references public.workflow_items(id) on delete set null,
  purpose text not null,
  amount numeric(14,2) not null,
  required_on date,
  expected_settlement_date date,
  justification text,
  spent_amount numeric(14,2) not null default 0,
  balance_returned numeric(14,2) not null default 0,
  status public.record_status not null default 'pending_approval',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text,
  type text not null default 'info',
  read_at timestamptz,
  link_view text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  detail text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_documents_owner on public.documents(owner_id);
create index if not exists idx_documents_ref on public.documents(reference_no);
create index if not exists idx_tasks_assignee on public.tasks(assignee_id, status);
create index if not exists idx_notifications_user on public.notifications(user_id, read_at, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.documents for each row execute function public.set_updated_at();
create trigger workflow_items_updated_at before update on public.workflow_items for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger estimates_updated_at before update on public.estimates for each row execute function public.set_updated_at();
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute function public.set_updated_at();
create trigger advance_requests_updated_at before update on public.advance_requests for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, employee_code, designation, department)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    nullif(new.raw_user_meta_data->>'employee_code',''),
    nullif(new.raw_user_meta_data->>'designation',''),
    nullif(new.raw_user_meta_data->>'department','')
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.workflow_items enable row level security;
alter table public.tasks enable row level security;
alter table public.approvals enable row level security;
alter table public.signatures enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.advance_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.same_department(target_department text)
returns boolean language sql stable security definer set search_path = public as $$
  select target_department is null or target_department = '' or target_department = (select department from public.profiles where id = auth.uid())
$$;

create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.current_role() in ('manager','admin'));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.current_role() in ('manager','admin')) with check (id = auth.uid() or public.current_role() in ('manager','admin'));

create policy documents_select on public.documents for select to authenticated using (owner_id = auth.uid() or public.same_department(department) or public.current_role() in ('manager','admin'));
create policy documents_insert on public.documents for insert to authenticated with check (owner_id = auth.uid());
create policy documents_update on public.documents for update to authenticated using (owner_id = auth.uid() or public.current_role() in ('manager','admin')) with check (owner_id = auth.uid() or public.current_role() in ('manager','admin'));
create policy documents_delete on public.documents for delete to authenticated using (owner_id = auth.uid() or public.current_role() = 'admin');

create policy workflow_select on public.workflow_items for select to authenticated using (owner_id = auth.uid() or public.same_department(department) or public.current_role() in ('manager','admin'));
create policy workflow_insert on public.workflow_items for insert to authenticated with check (owner_id = auth.uid());
create policy workflow_update on public.workflow_items for update to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin')) with check (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));

create policy tasks_select on public.tasks for select to authenticated using (created_by = auth.uid() or assignee_id = auth.uid() or public.same_department(department) or public.current_role() in ('manager','admin'));
create policy tasks_insert on public.tasks for insert to authenticated with check (created_by = auth.uid());
create policy tasks_update on public.tasks for update to authenticated using (created_by = auth.uid() or assignee_id = auth.uid() or public.current_role() in ('manager','admin')) with check (created_by = auth.uid() or assignee_id = auth.uid() or public.current_role() in ('manager','admin'));
create policy tasks_delete on public.tasks for delete to authenticated using (created_by = auth.uid() or public.current_role() = 'admin');

create policy approvals_select on public.approvals for select to authenticated using (requested_by = auth.uid() or approver_id = auth.uid() or public.current_role() in ('manager','admin'));
create policy approvals_insert on public.approvals for insert to authenticated with check (requested_by = auth.uid());
create policy approvals_update on public.approvals for update to authenticated using (approver_id = auth.uid() or public.current_role() in ('manager','admin')) with check (approver_id = auth.uid() or public.current_role() in ('manager','admin'));

create policy signatures_select on public.signatures for select to authenticated using (signer_id = auth.uid() or public.current_role() in ('manager','admin'));
create policy signatures_insert on public.signatures for insert to authenticated with check (signer_id = auth.uid());

create policy estimates_select on public.estimates for select to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));
create policy estimates_insert on public.estimates for insert to authenticated with check (owner_id = auth.uid());
create policy estimates_update on public.estimates for update to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin')) with check (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));
create policy estimate_items_select on public.estimate_items for select to authenticated using (exists(select 1 from public.estimates e where e.id = estimate_id and (e.owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'))));
create policy estimate_items_insert on public.estimate_items for insert to authenticated with check (exists(select 1 from public.estimates e where e.id = estimate_id and e.owner_id = auth.uid()));
create policy estimate_items_update on public.estimate_items for update to authenticated using (exists(select 1 from public.estimates e where e.id = estimate_id and (e.owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'))));
create policy estimate_items_delete on public.estimate_items for delete to authenticated using (exists(select 1 from public.estimates e where e.id = estimate_id and e.owner_id = auth.uid()));

create policy po_select on public.purchase_orders for select to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));
create policy po_insert on public.purchase_orders for insert to authenticated with check (owner_id = auth.uid());
create policy po_update on public.purchase_orders for update to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin')) with check (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));

create policy advance_select on public.advance_requests for select to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));
create policy advance_insert on public.advance_requests for insert to authenticated with check (owner_id = auth.uid());
create policy advance_update on public.advance_requests for update to authenticated using (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin')) with check (owner_id = auth.uid() or public.current_role() in ('approver','manager','admin'));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_select on public.audit_logs for select to authenticated using (actor_id = auth.uid() or public.current_role() in ('manager','admin'));
create policy audit_insert on public.audit_logs for insert to authenticated with check (actor_id = auth.uid());

-- Storage: create a private bucket named office-documents in the Dashboard if not already present.
-- Then add these policies in Storage > Policies:
-- 1) authenticated users can upload objects under a folder matching their auth UID.
-- 2) authenticated users can read objects under their UID or their department-sharing convention.
-- For highly sensitive records, keep the bucket private and issue signed URLs from a trusted backend.

-- Notification delivery from workflow actions.
create policy notifications_insert on public.notifications
for insert to authenticated
with check (user_id = auth.uid() or public.current_role() in ('approver','manager','admin'));

-- Private storage: files are stored under the uploader's auth UID.
-- Bucket must be created as a PRIVATE bucket named office-documents.
create policy office_documents_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'office-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy office_documents_select on storage.objects
for select to authenticated
using (bucket_id = 'office-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.current_role() in ('manager','admin')));

create policy office_documents_update on storage.objects
for update to authenticated
using (bucket_id = 'office-documents' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'office-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy office_documents_delete on storage.objects
for delete to authenticated
using (bucket_id = 'office-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.current_role() = 'admin'));
