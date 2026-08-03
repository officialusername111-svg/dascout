'use client'

import { useActionState, useId, useState } from 'react'
import { Icon } from '@/components/Icon'
import {
  IN_USE_TOOLTIP,
  NAV_GROUPS,
  PROPERTY_TYPE_ICONS,
  listingCountLabel,
} from '@/lib/admin/settings'
import type { ActionResult } from '@/app/admin/actions'
import {
  createFeature,
  createPropertyType,
  createTown,
  deleteFeature,
  deletePropertyType,
  deleteTown,
  updateFeature,
  updatePropertyType,
  updateTown,
} from '@/app/admin/settings-actions'
import type {
  SettingsFeatureRow,
  SettingsLists,
  SettingsPropertyTypeRow,
  SettingsTownRow,
} from '@/lib/admin/queries'

/**
 * The three lookup lists every listing draws from, on one screen.
 *
 * WHY THE TABS ARE CLIENT STATE AND NOT THREE ROUTES. The three lists are one job — the
 * owner opens this screen to tidy the vocabulary, not to visit a page — and they are small
 * enough that the server sends all three with the page. Making the tabs links would mean
 * three round trips to look at 40 rows, and would lose a half-typed add form on every
 * switch.
 *
 * WHAT IS AND IS NOT ENFORCED HERE. Everything on this screen is display: the disabled
 * delete, the missing slug field on an edit form, the icon list. Each of the three is
 * enforced again in `app/admin/settings-actions.ts`, and the two that matter most — the
 * delete guard and the immutable slug — are enforced a third time by the database (ON
 * DELETE RESTRICT, and a schema with no slug field to post). A disabled button is a
 * courtesy to the person reading it, never the rule.
 *
 * THE DELETE IS TWO PRESSES, deliberately, following `ListingActionBar`: these rows are
 * shared vocabulary, a mis-tap on a phone would take one out from under every listing that
 * used it, and there is no undo button anywhere in this product.
 */

type Tab = 'types' | 'towns' | 'features'

export function SettingsPanels({ lists }: { lists: SettingsLists }) {
  const [tab, setTab] = useState<Tab>('types')

  return (
    <>
      <div className="mtabs" role="group" aria-label="Which list to edit">
        <button type="button" aria-pressed={tab === 'types'} onClick={() => setTab('types')}>
          Property types
        </button>
        <button type="button" aria-pressed={tab === 'towns'} onClick={() => setTab('towns')}>
          Towns
        </button>
        <button type="button" aria-pressed={tab === 'features'} onClick={() => setTab('features')}>
          Features
        </button>
      </div>

      {tab === 'types' && <PropertyTypesPanel rows={lists.propertyTypes} />}
      {tab === 'towns' && <TownsPanel rows={lists.towns} />}
      {tab === 'features' && <FeaturesPanel rows={lists.features} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={active ? 'pill ok' : 'pill muted'}>{active ? 'Active' : 'Inactive'}</span>
  )
}

function Messages({ state }: { state: ActionResult | null }) {
  const failure = state && !state.ok ? state : null
  return (
    <>
      {state?.ok && state.message && (
        <div className="fmsg ok" role="status">
          {state.message}
        </div>
      )}
      {failure && (
        <div className="fmsg err" role="alert">
          {failure.message}
        </div>
      )}
    </>
  )
}

/**
 * Delete, behind a confirmation.
 *
 * `blocked` only decides what is DRAWN. The action counts the references again and the
 * foreign key refuses underneath it, so a stale page whose row has since been used cannot
 * delete anything — it gets the sentence back instead.
 */
function DeleteButton({
  id,
  name,
  action,
  blocked,
  blockedReason,
}: {
  id: string
  name: string
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>
  blocked: boolean
  blockedReason?: string
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null)
  const [confirming, setConfirming] = useState(false)
  const failure = state && !state.ok ? state : null

  return (
    <>
      <form action={formAction} className="adel">
        <input type="hidden" name="id" value={id} />
        {confirming ? (
          <>
            <button className="btn btn-dark abtn-sm" type="submit" disabled={pending}>
              {pending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              className="btn btn-quiet abtn-sm"
              type="button"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="btn btn-quiet abtn-sm"
            type="button"
            disabled={blocked}
            title={blocked ? (blockedReason ?? IN_USE_TOOLTIP) : undefined}
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${name}`}
          >
            Delete
          </button>
        )}
      </form>
      {failure && (
        <span className="fmsg err" role="alert">
          {failure.message}
        </span>
      )}
    </>
  )
}

/**
 * The defaults an uncontrolled field falls back to, and the counter that makes them stick.
 *
 * React resets a form as soon as its action settles, which throws every field back to its
 * `defaultValue` attribute — and for a `<select>` that attribute is only read at mount. The
 * counter below is bumped on every settled submission and used as a `key` on the field
 * block, so the whole set remounts with whatever the current defaults are: the values the
 * clerk just typed after a rejection, or the freshly saved row after a success.
 *
 * The same trick, and the same reasoning, as `components/admin/ListingForm.tsx`.
 */
function useFormEcho(state: ActionResult | null) {
  const [settled, setSettled] = useState(state)
  const [generation, setGeneration] = useState(0)
  if (settled !== state) {
    setSettled(state)
    setGeneration((count) => count + 1)
  }

  const failure = state && !state.ok ? state : null
  const errors = failure?.fieldErrors ?? {}
  const echoed = failure?.values

  return {
    generation,
    errors,
    initial: (name: string, stored: string) => echoed?.[name] ?? stored,
    fieldClass: (name: string) => `field${errors[name] ? ' invalid' : ''}`,
  }
}

function StatusField({
  id,
  value,
  className,
  error,
}: {
  id: string
  value: string
  className: string
  error?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id}>Status</label>
      <select id={id} name="is_active" defaultValue={value}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <div className="ferr">{error ?? 'Choose Active or Inactive.'}</div>
    </div>
  )
}

function SortOrderField({
  id,
  value,
  className,
  error,
}: {
  id: string
  value: string
  className: string
  error?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id}>Sort order</label>
      <input
        id={id}
        name="sort_order"
        type="number"
        inputMode="numeric"
        min={0}
        max={999}
        step={1}
        defaultValue={value}
      />
      <div className="hint">Lowest first. The built-in rows are 10 apart, so 25 slots between 20 and 30.</div>
      <div className="ferr">{error ?? 'A whole number from 0 to 999.'}</div>
    </div>
  )
}

/** The caption under every add form, in the words the sample approved. */
function SlugCaption({ what, example }: { what: string; example: string }) {
  return (
    <p className="amuted">
      The key becomes the public web address ({example}) and cannot be changed once
      {` ${what} `}
      is in use — so it is asked for once, here, and never appears on the edit form.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Property types
// ---------------------------------------------------------------------------

function PropertyTypesPanel({ rows }: { rows: SettingsPropertyTypeRow[] }) {
  const [adding, setAdding] = useState(false)

  return (
    <section className="apanel" aria-labelledby="typesH">
      <h2 id="typesH">Property types</h2>
      <p className="sub2">
        The zoning classification a listing is encoded against. The key is what appears in a
        public link, the sort order is the order the browse list uses, and an inactive type
        stays on the listings that already carry it.
      </p>

      {rows.length ? (
        <div className="alist">
          {rows.map((row) => (
            <PropertyTypeRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No property types yet</b>
          Add the first one below. Every listing has to be encoded against one.
        </div>
      )}

      {adding ? (
        <PropertyTypeForm onCancel={() => setAdding(false)} />
      ) : (
        <div className="aactions">
          <button className="btn btn-gold" type="button" onClick={() => setAdding(true)}>
            + Add property type
          </button>
        </div>
      )}
    </section>
  )
}

function PropertyTypeRow({ row }: { row: SettingsPropertyTypeRow }) {
  const [editing, setEditing] = useState(false)

  if (editing) return <PropertyTypeForm row={row} onCancel={() => setEditing(false)} />

  return (
    <div className="arow">
      <span className="aswatch">
        <Icon name={row.icon} />
      </span>
      <div className="t">
        <b>{row.name}</b>
        <span className="meta">
          {row.slug} · {row.groupLabel}
          {row.listingCount > 0 ? ` · used by ${listingCountLabel(row.listingCount)}` : ''}
        </span>
      </div>
      <span className="anum">{row.sortOrder}</span>
      <StatusPill active={row.isActive} />
      <div className="aactions">
        <button
          className="btn btn-ghost abtn-sm"
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${row.name}`}
        >
          Edit
        </button>
        <DeleteButton
          id={row.id}
          name={row.name}
          action={deletePropertyType}
          blocked={row.isBuiltIn || row.listingCount > 0}
          blockedReason={row.isBuiltIn ? 'Built-in type' : IN_USE_TOOLTIP}
        />
      </div>
    </div>
  )
}

function PropertyTypeForm({
  row,
  onCancel,
}: {
  row?: SettingsPropertyTypeRow
  onCancel: () => void
}) {
  const isEdit = Boolean(row)
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    isEdit ? updatePropertyType : createPropertyType,
    null
  )
  const { generation, errors, initial, fieldClass } = useFormEcho(state)
  const uid = useId()

  return (
    <form action={formAction} noValidate className="addform">
      <h3>{isEdit ? `Edit ${row!.name}` : 'New property type'}</h3>
      <Messages state={state} />

      {isEdit && <input type="hidden" name="id" value={row!.id} />}

      <div className="agrid" key={generation}>
        <div className={fieldClass('name')}>
          <label htmlFor={`${uid}-name`}>Name</label>
          <input
            id={`${uid}-name`}
            name="name"
            type="text"
            maxLength={60}
            defaultValue={initial('name', row?.name ?? '')}
            placeholder="e.g. Beach Property"
          />
          <div className="ferr">{errors.name ?? 'Give the property type a name.'}</div>
        </div>

        <div className={fieldClass('plural_name')}>
          <label htmlFor={`${uid}-plural`}>Plural name</label>
          <input
            id={`${uid}-plural`}
            name="plural_name"
            type="text"
            maxLength={80}
            defaultValue={initial('plural_name', row?.pluralName ?? '')}
            placeholder="e.g. Beach Properties"
          />
          <div className="ferr">
            {errors.plural_name ?? 'Used as the heading on the browse list.'}
          </div>
        </div>

        {!isEdit && (
          <div className={`${fieldClass('slug')} wide`}>
            <label htmlFor={`${uid}-slug`}>Key for the web address</label>
            <input
              id={`${uid}-slug`}
              name="slug"
              type="text"
              maxLength={40}
              autoComplete="off"
              defaultValue={initial('slug', '')}
              placeholder="e.g. beach-property"
            />
            <div className="ferr">
              {errors.slug ?? 'Lowercase letters, numbers and single hyphens.'}
            </div>
          </div>
        )}

        <div className={fieldClass('group_key')}>
          <label htmlFor={`${uid}-group`}>Nav group</label>
          <select
            id={`${uid}-group`}
            name="group_key"
            defaultValue={initial('group_key', row?.groupKey ?? '')}
          >
            {NAV_GROUPS.map((group) => (
              <option key={group.value || 'none'} value={group.value}>
                {group.label}
              </option>
            ))}
          </select>
          <div className="hint">Ungrouped types sit on their own in the browse menu.</div>
          <div className="ferr">{errors.group_key ?? 'Choose a nav group from the list.'}</div>
        </div>

        <div className={fieldClass('icon')}>
          <label htmlFor={`${uid}-icon`}>Icon</label>
          <select id={`${uid}-icon`} name="icon" defaultValue={initial('icon', row?.icon ?? 'pin')}>
            {PROPERTY_TYPE_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </select>
          {/* The list is fixed because an icon is a sprite id, not a word: a name the
              sprite does not carry renders as nothing at all. */}
          <div className="hint">Shown beside the type wherever it is listed.</div>
          <div className="ferr">{errors.icon ?? 'Choose one of the icons in the list.'}</div>
        </div>

        <SortOrderField
          id={`${uid}-sort`}
          className={fieldClass('sort_order')}
          value={initial('sort_order', String(row?.sortOrder ?? 100))}
          error={errors.sort_order}
        />

        <StatusField
          id={`${uid}-status`}
          className={fieldClass('is_active')}
          value={initial('is_active', row && !row.isActive ? 'inactive' : 'active')}
          error={errors.is_active}
        />
      </div>

      <div className="aactions">
        <button className="btn btn-gold" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onCancel}>
          {isEdit ? 'Close' : 'Cancel'}
        </button>
      </div>

      {!isEdit && <SlugCaption what="the type" example="?cat=beach-property" />}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Towns
// ---------------------------------------------------------------------------

function TownsPanel({ rows }: { rows: SettingsTownRow[] }) {
  const [adding, setAdding] = useState(false)

  return (
    <section className="apanel" aria-labelledby="townsH">
      <h2 id="townsH">Towns</h2>
      <p className="sub2">
        Where a property is. A town cannot be deleted while listings still sit in it —
        set it to Inactive instead, which keeps every existing listing intact and takes it
        out of the encoder&rsquo;s list.
      </p>

      {rows.length ? (
        <div className="alist">
          {rows.map((row) => (
            <TownRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No towns yet</b>
          Add the first one below. Every listing has to sit in one.
        </div>
      )}

      {adding ? (
        <TownForm onCancel={() => setAdding(false)} />
      ) : (
        <div className="aactions">
          <button className="btn btn-gold" type="button" onClick={() => setAdding(true)}>
            + Add town
          </button>
        </div>
      )}
    </section>
  )
}

function TownRow({ row }: { row: SettingsTownRow }) {
  const [editing, setEditing] = useState(false)

  if (editing) return <TownForm row={row} onCancel={() => setEditing(false)} />

  return (
    <div className="arow">
      <div className="t">
        <b>{row.name}</b>
        <span className="meta">
          {row.province}
          {row.listingCount > 0 ? ` · used by ${listingCountLabel(row.listingCount)}` : ''}
        </span>
      </div>
      <StatusPill active={row.isActive} />
      <div className="aactions">
        <button
          className="btn btn-ghost abtn-sm"
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${row.name}`}
        >
          Edit
        </button>
        <DeleteButton
          id={row.id}
          name={row.name}
          action={deleteTown}
          blocked={row.listingCount > 0}
        />
      </div>
    </div>
  )
}

function TownForm({ row, onCancel }: { row?: SettingsTownRow; onCancel: () => void }) {
  const isEdit = Boolean(row)
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    isEdit ? updateTown : createTown,
    null
  )
  const { generation, errors, initial, fieldClass } = useFormEcho(state)
  const uid = useId()

  return (
    <form action={formAction} noValidate className="addform">
      <h3>{isEdit ? `Edit ${row!.name}` : 'New town'}</h3>
      <Messages state={state} />

      {isEdit && <input type="hidden" name="id" value={row!.id} />}

      <div className="agrid" key={generation}>
        <div className={fieldClass('name')}>
          <label htmlFor={`${uid}-name`}>Name</label>
          <input
            id={`${uid}-name`}
            name="name"
            type="text"
            maxLength={80}
            defaultValue={initial('name', row?.name ?? '')}
            placeholder="e.g. Polomolok"
          />
          <div className="ferr">{errors.name ?? 'Give the town a name.'}</div>
        </div>

        <div className={fieldClass('province')}>
          <label htmlFor={`${uid}-province`}>Province</label>
          <input
            id={`${uid}-province`}
            name="province"
            type="text"
            maxLength={80}
            defaultValue={initial('province', row?.province ?? '')}
            placeholder="e.g. South Cotabato"
          />
          <div className="ferr">{errors.province ?? 'Give the province.'}</div>
        </div>

        {isEdit ? (
          <StatusField
            id={`${uid}-status`}
            className={fieldClass('is_active')}
            value={initial('is_active', row && !row.isActive ? 'inactive' : 'active')}
            error={errors.is_active}
          />
        ) : (
          <div className={fieldClass('slug')}>
            <label htmlFor={`${uid}-slug`}>Key for the web address</label>
            <input
              id={`${uid}-slug`}
              name="slug"
              type="text"
              maxLength={60}
              autoComplete="off"
              defaultValue={initial('slug', '')}
              placeholder="e.g. polomolok"
            />
            <div className="ferr">
              {errors.slug ?? 'Lowercase letters, numbers and single hyphens.'}
            </div>
          </div>
        )}
      </div>

      <div className="aactions">
        <button className="btn btn-gold" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onCancel}>
          {isEdit ? 'Close' : 'Cancel'}
        </button>
      </div>

      {!isEdit && (
        <p className="amuted">
          The key is the town&rsquo;s stable handle and is asked for once, here — a town can
          be renamed afterwards without anything else having to change.
        </p>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function FeaturesPanel({ rows }: { rows: SettingsFeatureRow[] }) {
  const [adding, setAdding] = useState(false)
  const inUse = rows.filter((row) => row.listingCount > 0)

  return (
    <section className="apanel" aria-labelledby="featuresH">
      <h2 id="featuresH">Features</h2>
      <p className="sub2">
        The chips a listing carries. Renaming one is safe — the public link uses the key,
        not the name — but a feature attached to a listing cannot be deleted.
      </p>

      {rows.length ? (
        <div className="alist">
          {rows.map((row) => (
            <FeatureRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No features yet</b>
          Add the first one below. Features are shared across every listing.
        </div>
      )}

      {/*
        Said once, under the list, rather than repeated on every blocked row. The disabled
        button carries the short "In use"; this is the sentence that says what to do about
        it.
      */}
      {inUse.length > 0 && (
        <div className="warnrow">
          {inUse.length === 1 ? (
            <>
              Deleting <b>{inUse[0].name}</b> is blocked — {listingCountLabel(inUse[0].listingCount)}{' '}
              still {inUse[0].listingCount === 1 ? 'carries' : 'carry'} it. Remove it from those
              listings first.
            </>
          ) : (
            <>
              {inUse.length} features cannot be deleted because listings still carry them.
              Remove a feature from every listing that has it before deleting it here.
            </>
          )}
        </div>
      )}

      {adding ? (
        <FeatureForm onCancel={() => setAdding(false)} />
      ) : (
        <div className="aactions">
          <button className="btn btn-gold" type="button" onClick={() => setAdding(true)}>
            + Add feature
          </button>
        </div>
      )}
    </section>
  )
}

function FeatureRow({ row }: { row: SettingsFeatureRow }) {
  const [editing, setEditing] = useState(false)

  if (editing) return <FeatureForm row={row} onCancel={() => setEditing(false)} />

  return (
    <div className="arow">
      <div className="t">
        <b>{row.name}</b>
        <span className="meta">
          {row.slug}
          {row.listingCount > 0 ? ` · used by ${listingCountLabel(row.listingCount)}` : ''}
        </span>
      </div>
      <span className="anum">{row.sortOrder}</span>
      <StatusPill active={row.isActive} />
      <div className="aactions">
        <button
          className="btn btn-ghost abtn-sm"
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${row.name}`}
        >
          Edit
        </button>
        <DeleteButton
          id={row.id}
          name={row.name}
          action={deleteFeature}
          blocked={row.listingCount > 0}
        />
      </div>
    </div>
  )
}

function FeatureForm({ row, onCancel }: { row?: SettingsFeatureRow; onCancel: () => void }) {
  const isEdit = Boolean(row)
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    isEdit ? updateFeature : createFeature,
    null
  )
  const { generation, errors, initial, fieldClass } = useFormEcho(state)
  const uid = useId()

  return (
    <form action={formAction} noValidate className="addform">
      <h3>{isEdit ? `Edit ${row!.name}` : 'New feature'}</h3>
      <Messages state={state} />

      {isEdit && <input type="hidden" name="id" value={row!.id} />}

      <div className="agrid" key={generation}>
        <div className={fieldClass('name')}>
          <label htmlFor={`${uid}-name`}>Name</label>
          <input
            id={`${uid}-name`}
            name="name"
            type="text"
            maxLength={60}
            defaultValue={initial('name', row?.name ?? '')}
            placeholder="e.g. Fenced"
          />
          <div className="ferr">{errors.name ?? 'Give the feature a name.'}</div>
        </div>

        {!isEdit && (
          <div className={fieldClass('slug')}>
            <label htmlFor={`${uid}-slug`}>Key for the web address</label>
            <input
              id={`${uid}-slug`}
              name="slug"
              type="text"
              maxLength={60}
              autoComplete="off"
              defaultValue={initial('slug', '')}
              placeholder="e.g. fenced"
            />
            <div className="ferr">
              {errors.slug ?? 'Lowercase letters, numbers and single hyphens.'}
            </div>
          </div>
        )}

        <SortOrderField
          id={`${uid}-sort`}
          className={fieldClass('sort_order')}
          value={initial('sort_order', String(row?.sortOrder ?? 100))}
          error={errors.sort_order}
        />

        <StatusField
          id={`${uid}-status`}
          className={fieldClass('is_active')}
          value={initial('is_active', row && !row.isActive ? 'inactive' : 'active')}
          error={errors.is_active}
        />
      </div>

      <div className="aactions">
        <button className="btn btn-gold" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onCancel}>
          {isEdit ? 'Close' : 'Cancel'}
        </button>
      </div>

      {!isEdit && <SlugCaption what="the feature" example="?feat=fenced" />}
    </form>
  )
}
