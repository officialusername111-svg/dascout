'use client'

import { useActionState, useState } from 'react'
import { createListing, updateListing, type ActionResult } from '@/app/admin/actions'
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories'

/**
 * The listing's own fields, for both create and edit.
 *
 * The browser attributes (`required`, `min`, `step`) are convenience only — every one
 * of these rules is enforced again in the action, which is the only copy that counts.
 * The server's answer is what renders: field messages come back keyed by field name and
 * are shown under the input they belong to, and a rejected submission keeps everything
 * the clerk typed rather than emptying the form.
 *
 * There is no rent, lease or price-period control anywhere here on purpose. DaScout
 * lists properties for sale, in pesos, and a stray "per month" option would be a
 * product change disguised as a form field.
 */

export type ListingFormValues = {
  id: string
  slug: string
  propertyNo: string | null
  title: string
  category: string
  pricePhp: number
  townId: string
  areaDetail: string | null
  lotAreaSqm: number | null
  floorAreaSqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  description: string | null
  isTrending: boolean
}

type Props =
  | { mode: 'create'; towns: { id: string; label: string }[] }
  | {
      mode: 'edit'
      towns: { id: string; label: string }[]
      listing: ListingFormValues
      slugEditable: boolean
      statusLabel: string
    }

function numberValue(value: number | null): string {
  return value === null ? '' : String(value)
}

export function ListingForm(props: Props) {
  const isEdit = props.mode === 'edit'
  const action = isEdit ? updateListing : createListing
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null)

  const failure = state && !state.ok ? state : null
  const errors = failure?.fieldErrors ?? {}
  const listing = isEdit ? props.listing : null

  const fieldClass = (name: string) => `field${errors[name] ? ' invalid' : ''}`

  /**
   * What the last rejected submission carried, falling back to the stored listing.
   *
   * The order matters and is the whole point: React resets this form as soon as its
   * action settles, so on a rejection every input goes back to its `defaultValue`. If
   * that default were still the stored listing, a single bad bedroom count would throw
   * away the title, price and description the clerk had just typed — and in create mode
   * there is no stored listing at all, so the form would come back completely empty.
   */
  const echoed = failure?.values
  const initial = (name: string, stored: string) => echoed?.[name] ?? stored

  /**
   * A counter that moves on every settled submission, used to remount the dropdowns.
   *
   * Inputs and textareas restore themselves from the echoed defaults above, because
   * React rewrites their `defaultValue` attribute on each render and the reset reads
   * that attribute. A `<select>` is different: React only applies `defaultValue` when
   * the element mounts, so after a reset both dropdowns sit on their empty placeholder
   * with no way back. Remounting them is what makes the restored value stick.
   *
   * Making them controlled instead looks tidier and is a trap: the reset moves the DOM
   * without telling React, React sees no change in its own value and leaves the DOM
   * alone, and the *next* submission quietly posts an empty category. Measured, not
   * guessed.
   *
   * Adjusting state during render like this is the same pattern `components/Dialogs.tsx`
   * uses to clear a message when its tab changes — React re-runs the render immediately,
   * before the browser paints.
   */
  const [settled, setSettled] = useState(state)
  const [generation, setGeneration] = useState(0)
  if (settled !== state) {
    setSettled(state)
    setGeneration((count) => count + 1)
  }

  return (
    <form action={formAction} noValidate className="apanel">
      <h2>{isEdit ? 'Listing details' : 'New listing'}</h2>
      <p className="sub2">
        {isEdit
          ? 'Editable in every status. Changing the price on a live listing is recorded in the price history automatically.'
          : 'Saved as a draft. Nothing is published until it has been through verification.'}
      </p>

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

      {isEdit && <input type="hidden" name="listingId" value={props.listing.id} />}

      <div className="agrid">
        {/* First, because it is the identifier: the number the office quotes on the phone
            before anybody says the title. Optional — nothing refuses a listing without
            one — but unique across every listing that has one. */}
        <div className={`${fieldClass('property_no')} wide`}>
          <label htmlFor="lf-propno">
            Property number <span className="amuted">(optional)</span>
          </label>
          <input
            id="lf-propno"
            name="property_no"
            type="text"
            maxLength={24}
            autoComplete="off"
            defaultValue={initial('property_no', listing?.propertyNo ?? '')}
            placeholder="e.g. DS-0142"
          />
          <div className="hint">
            Your own reference for this property. It has to be different from every other
            listing&rsquo;s. Once the listing is live this is shown on its public page and
            put in the subject line of enquiries, so buyers can quote it back to you.
          </div>
          <div className="ferr">
            {errors.property_no ?? 'Up to 24 characters, and not already in use.'}
          </div>
        </div>

        <div className={`${fieldClass('title')} wide`}>
          <label htmlFor="lf-title">Title</label>
          <input
            id="lf-title"
            name="title"
            type="text"
            required
            minLength={3}
            maxLength={160}
            defaultValue={initial('title', listing?.title ?? '')}
            placeholder="e.g. Corner Residential Lot, Lagao"
          />
          <div className="ferr">{errors.title ?? 'Give the listing a title.'}</div>
        </div>

        <div className={fieldClass('category')}>
          <label htmlFor="lf-category">Property type</label>
          <select
            key={`category-${generation}`}
            id="lf-category"
            name="category"
            required
            defaultValue={initial('category', listing?.category ?? '')}
          >
            <option value="" disabled>
              Choose a type…
            </option>
            {CATEGORY_KEYS.map((key) => (
              <option key={key} value={CATEGORIES[key].db}>
                {CATEGORIES[key].label}
              </option>
            ))}
          </select>
          <div className="ferr">{errors.category ?? 'Choose one of the five property types.'}</div>
        </div>

        <div className={fieldClass('town_id')}>
          <label htmlFor="lf-town">Town</label>
          <select
            key={`town-${generation}`}
            id="lf-town"
            name="town_id"
            required
            defaultValue={initial('town_id', listing?.townId ?? '')}
          >
            <option value="" disabled>
              Choose a town…
            </option>
            {props.towns.map((town) => (
              <option key={town.id} value={town.id}>
                {town.label}
              </option>
            ))}
          </select>
          <div className="ferr">{errors.town_id ?? 'Choose a town from the list.'}</div>
        </div>

        <div className={fieldClass('price_php')}>
          <label htmlFor="lf-price">Asking price (₱)</label>
          <input
            id="lf-price"
            name="price_php"
            type="number"
            inputMode="numeric"
            required
            min={1}
            step={1}
            defaultValue={initial('price_php', listing ? String(listing.pricePhp) : '')}
            placeholder="1500000"
          />
          <div className="hint">Sale price in pesos. DaScout does not list rentals.</div>
          <div className="ferr">{errors.price_php ?? 'Enter the asking price in pesos.'}</div>
        </div>

        <div className={fieldClass('area_detail')}>
          <label htmlFor="lf-area">
            Barangay or area <span className="amuted">(optional)</span>
          </label>
          <input
            id="lf-area"
            name="area_detail"
            type="text"
            maxLength={160}
            defaultValue={initial('area_detail', listing?.areaDetail ?? '')}
            placeholder="e.g. Lagao"
          />
          <div className="ferr">{errors.area_detail ?? 'Keep this under 160 characters.'}</div>
        </div>

        <div className={fieldClass('lot_area_sqm')}>
          <label htmlFor="lf-lot">
            Lot area, sqm <span className="amuted">(optional)</span>
          </label>
          <input
            id="lf-lot"
            name="lot_area_sqm"
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            defaultValue={initial('lot_area_sqm', numberValue(listing?.lotAreaSqm ?? null))}
          />
          <div className="ferr">{errors.lot_area_sqm ?? 'Leave blank if unknown.'}</div>
        </div>

        <div className={fieldClass('floor_area_sqm')}>
          <label htmlFor="lf-floor">
            Floor area, sqm <span className="amuted">(optional)</span>
          </label>
          <input
            id="lf-floor"
            name="floor_area_sqm"
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            defaultValue={initial('floor_area_sqm', numberValue(listing?.floorAreaSqm ?? null))}
          />
          <div className="ferr">{errors.floor_area_sqm ?? 'Leave blank if unknown.'}</div>
        </div>

        <div className={fieldClass('bedrooms')}>
          <label htmlFor="lf-bed">
            Bedrooms <span className="amuted">(optional)</span>
          </label>
          <input
            id="lf-bed"
            name="bedrooms"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={initial('bedrooms', numberValue(listing?.bedrooms ?? null))}
          />
          <div className="ferr">{errors.bedrooms ?? 'A whole number, or blank.'}</div>
        </div>

        <div className={fieldClass('bathrooms')}>
          <label htmlFor="lf-bath">
            Bathrooms <span className="amuted">(optional)</span>
          </label>
          <input
            id="lf-bath"
            name="bathrooms"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={initial('bathrooms', numberValue(listing?.bathrooms ?? null))}
          />
          <div className="ferr">{errors.bathrooms ?? 'A whole number, or blank.'}</div>
        </div>

        {isEdit && props.slugEditable && (
          <div className={`${fieldClass('slug')} wide`}>
            <label htmlFor="lf-slug">Web address</label>
            <input
              id="lf-slug"
              name="slug"
              type="text"
              maxLength={90}
              defaultValue={initial('slug', props.listing.slug)}
            />
            <div className="hint">
              dascoutprime.com/property/<b>{props.listing.slug}</b> — editable only while the
              listing is a draft or in verification. Once published it is fixed so existing links
              keep working.
            </div>
            <div className="ferr">
              {errors.slug ?? 'Lowercase letters, numbers and single hyphens only.'}
            </div>
          </div>
        )}

        {isEdit && !props.slugEditable && (
          <div className="field wide">
            <label>Web address</label>
            <p className="amuted">
              /property/{props.listing.slug} — fixed, because this listing is {props.statusLabel.toLowerCase()}{' '}
              and the address is already in search results and other people&rsquo;s messages.
            </p>
          </div>
        )}

        <div className={`${fieldClass('description')} wide`}>
          <label htmlFor="lf-desc">
            Description <span className="amuted">(optional)</span>
          </label>
          <textarea
            id="lf-desc"
            name="description"
            rows={5}
            maxLength={4000}
            defaultValue={initial('description', listing?.description ?? '')}
            placeholder="What a buyer walking the property would want to know."
          />
          <div className="ferr">{errors.description ?? 'Keep this under 4000 characters.'}</div>
        </div>

        <div className="field wide">
          <label htmlFor="lf-trend" style={{ display: 'flex', gap: 9, alignItems: 'center', minHeight: 44 }}>
            <input
              id="lf-trend"
              name="is_trending"
              type="checkbox"
              defaultChecked={echoed ? echoed.is_trending === 'on' : (listing?.isTrending ?? false)}
              style={{ width: 18, height: 18, minHeight: 0, padding: 0 }}
            />
            Show in the Trending tab on the home page
          </label>
        </div>
      </div>

      <div className="aactions">
        <button className="btn btn-gold" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isEdit ? 'Save details' : 'Create draft'}
        </button>
        {!isEdit && <span className="amuted">You can add photos on the next screen.</span>}
      </div>
    </form>
  )
}
