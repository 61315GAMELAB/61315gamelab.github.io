begin;

drop policy if exists "Public read portfolios" on storage.objects;

revoke execute on function public.reserve_slot(uuid) from public;
revoke execute on function public.unreserve_slot(uuid) from public;

revoke execute on function public.reserve_slot(uuid) from anon, authenticated;
revoke execute on function public.unreserve_slot(uuid) from anon, authenticated;

grant execute on function public.reserve_slot(uuid) to service_role;
grant execute on function public.unreserve_slot(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
