import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import type { ContactProfile, ReminderItem } from '../types/reminder';
import {
  buildPeopleSummaries,
  normalizePersonKey,
} from '../services/contacts';
import { formatDueLabel, formatTimelineTimestamp, getPersonInitials } from '../services/time';
import { AssistantOrb } from './AssistantOrb';
import { ReminderCard } from './ReminderCard';

interface PeopleViewProps {
  items: ReminderItem[];
  contactsMap: Record<string, ContactProfile>;
  initialPersonKey?: string | null;
  onSaveContact: (contact: ContactProfile) => void;
  onAddReminderForPerson: (personName: string) => void;
  onComplete: (item: ReminderItem) => void;
  onSnoozeQuick: (item: ReminderItem) => void;
  onOpenTimeline: (item: ReminderItem) => void;
}

export function PeopleView({
  items,
  contactsMap,
  initialPersonKey,
  onSaveContact,
  onAddReminderForPerson,
  onComplete,
  onSnoozeQuick,
  onOpenTimeline,
}: PeopleViewProps) {
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(initialPersonKey || null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  // Add / Edit Contact Form fields
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [newCommitment, setNewCommitment] = useState('');

  const people = useMemo(
    () => buildPeopleSummaries(items, contactsMap),
    [items, contactsMap]
  );

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.contact.company && p.contact.company.toLowerCase().includes(q)) ||
        (p.contact.role && p.contact.role.toLowerCase().includes(q)) ||
        (p.contact.email && p.contact.email.toLowerCase().includes(q))
    );
  }, [people, search]);

  const activePerson = useMemo(
    () => people.find((p) => p.key === selectedKey) || null,
    [people, selectedKey]
  );

  const openEditProfile = (contact: ContactProfile) => {
    setFormName(contact.name);
    setFormRole(contact.role || '');
    setFormCompany(contact.company || '');
    setFormEmail(contact.email || '');
    setFormPhone(contact.phone || '');
    setFormNotes(contact.notes || '');
    setEditingProfile(true);
  };

  const handleSaveEditedContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    const key = normalizePersonKey(formName);
    const existingCommitments = activePerson?.contact.commitments || [];
    onSaveContact({
      key,
      name: formName.trim(),
      role: formRole.trim() || undefined,
      company: formCompany.trim() || undefined,
      email: formEmail.trim() || undefined,
      phone: formPhone.trim() || undefined,
      notes: formNotes.trim() || undefined,
      commitments: existingCommitments,
    });
    setSelectedKey(key);
    setEditingProfile(false);
    setShowAddContact(false);
  };

  const handleAddCommitment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePerson || !newCommitment.trim()) return;
    const nextCommitments = [
      ...(activePerson.contact.commitments || []),
      newCommitment.trim(),
    ];
    onSaveContact({
      ...activePerson.contact,
      commitments: nextCommitments,
    });
    setNewCommitment('');
  };

  if (activePerson) {
    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedKey(null);
              setEditingProfile(false);
            }}
            className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-white dark:hover:bg-[#1A1726] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>All people</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openEditProfile(activePerson.contact)}
              className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] hover:border-[#7657D5]/60"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit info</span>
            </button>
            <button
              type="button"
              onClick={() => onAddReminderForPerson(activePerson.name)}
              className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-xs font-semibold"
            >
              <Plus className="w-4 h-4" />
              <span className="truncate max-w-[180px] sm:max-w-none">Follow up with {activePerson.name}</span>
            </button>
          </div>
        </div>

        {/* Contact Profile Header */}
        <div className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
              <span className="w-14 h-14 rounded-2xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-lg font-bold flex items-center justify-center shrink-0">
                {getPersonInitials(activePerson.name) || activePerson.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA] truncate">
                  {activePerson.name}
                </h1>
                <p className="text-sm text-[#666173] dark:text-[#A7A2B8] truncate">
                  {[activePerson.contact.role, activePerson.contact.company]
                    .filter(Boolean)
                    .join(' · ') || 'Contact profile'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:gap-4 sm:text-right">
              <div className="min-w-0">
                <p className="text-lg font-bold font-mono tabular-nums text-[#7657D5] dark:text-[#C5B4FF]">
                  {activePerson.pendingItems.length}
                </p>
                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Pending</p>
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {activePerson.completedItems.length}
                </p>
                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Completed</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA] mt-1 truncate">
                  {activePerson.lastInteractionAt
                    ? formatTimelineTimestamp(activePerson.lastInteractionAt)
                    : 'No activity'}
                </p>
                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">Last activity</p>
              </div>
            </div>
          </div>

          {/* Contact details */}
          {(activePerson.contact.email ||
            activePerson.contact.phone ||
            activePerson.contact.notes) && (
            <div className="pt-4 border-t border-[#EFEBF7] dark:border-[#2C2740] flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#666173] dark:text-[#A7A2B8]">
              {activePerson.contact.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#7657D5]" />
                  <span>{activePerson.contact.email}</span>
                </span>
              )}
              {activePerson.contact.phone && (
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <Phone className="w-3.5 h-3.5 text-[#7657D5]" />
                  <span>{activePerson.contact.phone}</span>
                </span>
              )}
              {activePerson.contact.company && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#7657D5]" />
                  <span>{activePerson.contact.company}</span>
                </span>
              )}
              {activePerson.contact.notes && (
                <p className="w-full text-xs text-[#24212B] dark:text-[#F5F3FA] pt-1">
                  {activePerson.contact.notes}
                </p>
              )}
            </div>
          )}

          {/* Inline Edit Form */}
          {editingProfile && (
            <form
              onSubmit={handleSaveEditedContact}
              className="pt-4 border-t border-[#EFEBF7] dark:border-[#2C2740] space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Full name"
                  className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
                />
                <input
                  type="text"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  placeholder="Role (e.g., Account Lead)"
                  className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
                />
                <input
                  type="text"
                  value={formCompany}
                  onChange={(e) => setFormCompany(e.target.value)}
                  placeholder="Company"
                  className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
                />
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="Email address"
                  className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
                />
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="Phone number"
                  className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
                />
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Notes or communication preferences"
                  className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingProfile(false)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#7657D5] text-white text-xs font-semibold"
                >
                  Save contact
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Promises & Commitments + Pending & Completed Follow-ups */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Promises &amp; commitments
                </h2>
                <span className="text-xs font-mono tabular-nums text-[#666173]">
                  {activePerson.promisesAndCommitments.length}
                </span>
              </div>

              {activePerson.promisesAndCommitments.length === 0 ? (
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                  No promises recorded yet. Pin one below or log an update on a follow-up.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {activePerson.promisesAndCommitments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#EFEBF7] dark:border-[#2C2740] p-3 space-y-1"
                    >
                      <p className="text-xs text-[#24212B] dark:text-[#F5F3FA] leading-relaxed">
                        {c.text}
                      </p>
                      <p className="text-[11px] text-[#8E889C] font-mono">
                        {c.itemTitle} · {formatTimelineTimestamp(c.timestamp)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleAddCommitment} className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={newCommitment}
                  onChange={(e) => setNewCommitment(e.target.value)}
                  placeholder="Pin a promise or commitment..."
                  className="flex-1 min-w-0 h-11 sm:h-9 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-xs"
                />
                <button
                  type="submit"
                  disabled={!newCommitment.trim()}
                  className="min-h-[44px] sm:min-h-[36px] px-3.5 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] disabled:opacity-40 text-xs font-semibold shrink-0"
                >
                  Pin
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Pending follow-ups
                </h2>
                <span className="text-xs font-mono tabular-nums text-[#666173]">
                  {activePerson.pendingItems.length}
                </span>
              </div>
              {activePerson.pendingItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#DDD3FA] dark:border-[#3D3363] p-6 text-center text-xs text-[#666173] dark:text-[#A7A2B8]">
                  Nothing pending with {activePerson.name} right now.
                </div>
              ) : (
                <div className="space-y-3">
                  {activePerson.pendingItems.map((item) => (
                    <ReminderCard
                      key={item.id}
                      item={item}
                      onComplete={onComplete}
                      onSnoozeQuick={onSnoozeQuick}
                      onOpenTimeline={onOpenTimeline}
                      allowInlineTimeline
                    />
                  ))}
                </div>
              )}
            </section>

            {activePerson.completedItems.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold font-display text-[#666173] dark:text-[#A7A2B8]">
                    Completed follow-ups &amp; conversation history
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-[#666173]">
                    {activePerson.completedItems.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {activePerson.completedItems.map((item) => (
                    <ReminderCard
                      key={item.id}
                      item={item}
                      onComplete={onComplete}
                      onSnoozeQuick={onSnoozeQuick}
                      onOpenTimeline={onOpenTimeline}
                      allowInlineTimeline
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
            People
          </h1>
          <p className="text-sm text-[#666173] dark:text-[#A7A2B8]">
            Every contact, conversation thread, and commitment Oopsie remembers for you.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormName('');
            setFormRole('');
            setFormCompany('');
            setFormEmail('');
            setFormPhone('');
            setFormNotes('');
            setShowAddContact((v) => !v);
          }}
          className="min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add contact</span>
        </button>
      </div>

      {showAddContact && (
        <form
          onSubmit={handleSaveEditedContact}
          className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
            New contact profile
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input
              type="text"
              required
              autoFocus
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Name *"
              className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
            <input
              type="text"
              value={formRole}
              onChange={(e) => setFormRole(e.target.value)}
              placeholder="Role"
              className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
            <input
              type="text"
              value={formCompany}
              onChange={(e) => setFormCompany(e.target.value)}
              placeholder="Company"
              className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
            <input
              type="email"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              placeholder="Email"
              className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
            <input
              type="tel"
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              placeholder="Phone"
              className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
            <input
              type="text"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Notes"
              className="h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddContact(false)}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#7657D5] text-white text-xs font-semibold"
            >
              Save contact
            </button>
          </div>
        </form>
      )}

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-[#8E889C] absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people by name, company, or email..."
          className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA]"
        />
      </div>

      {filteredPeople.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-10 text-center flex flex-col items-center space-y-3">
          <AssistantOrb mood="idle" size="md" />
          <p className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
            No contacts found yet
          </p>
          <p className="text-xs text-[#666173] dark:text-[#A7A2B8] max-w-sm">
            Mention a person in any reminder (like &quot;Follow up with Rahul&quot;) or add a contact profile here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPeople.map((person) => {
            const nextDue = person.pendingItems[0];
            return (
              <div
                key={person.key}
                className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5]/60 p-5 transition-colors flex flex-col justify-between gap-4"
              >
                <div
                  className="cursor-pointer space-y-3"
                  onClick={() => setSelectedKey(person.key)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-11 h-11 rounded-2xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-sm font-bold flex items-center justify-center shrink-0">
                        {getPersonInitials(person.name) || person.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA] truncate">
                          {person.name}
                        </h3>
                        <p className="text-xs text-[#666173] dark:text-[#A7A2B8] truncate">
                          {[person.contact.role, person.contact.company]
                            .filter(Boolean)
                            .join(' · ') || 'Follow-up contact'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#666173] dark:text-[#A7A2B8]">
                    <span className="inline-flex items-center gap-1 font-medium text-[#7657D5] dark:text-[#C5B4FF]">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-mono tabular-nums">{person.pendingItems.length}</span>{' '}
                      pending
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-mono tabular-nums">{person.completedItems.length}</span>{' '}
                      done
                    </span>
                  </div>

                  {nextDue ? (
                    <p className="text-xs text-[#24212B] dark:text-[#F5F3FA] line-clamp-2 leading-relaxed bg-[#FAF9FC] dark:bg-[#12101A] rounded-xl px-3 py-2">
                      Next: {nextDue.title} ({formatDueLabel(nextDue.dueAt)})
                    </p>
                  ) : (
                    <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                      Last interaction:{' '}
                      {person.lastInteractionAt
                        ? formatTimelineTimestamp(person.lastInteractionAt)
                        : 'No reminders yet'}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EFEBF7] dark:border-[#2C2740]">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(person.key)}
                    className="min-h-[44px] sm:min-h-[34px] inline-flex items-center text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
                  >
                    View profile &amp; history
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddReminderForPerson(person.name)}
                    className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#EAE4FF]/70 dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] hover:bg-[#7657D5] hover:text-white text-xs font-semibold transition-colors shrink-0"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Follow up</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
