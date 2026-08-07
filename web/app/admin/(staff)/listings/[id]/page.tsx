import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FeaturesForm } from '@/components/admin/FeaturesForm'
import { ListingActionBar } from '@/components/admin/ListingActionBar'
import { ListingForm } from '@/components/admin/ListingForm'
import { PhotoManager } from '@/components/admin/PhotoManager'
import { backHrefFrom, one } from '@/lib/admin/navigation'
import { displayTitle } from '@/lib/format'
import {
  getAdminListingDetail,
  getFeatureOptions,
  getListingStatusHistory,
  getPropertyTypeOptions,
  getTownOptions,
  type CheckAnchor,
} from '@/lib/admin/queries'

type Search = Record<string, string | string[] | undefined>
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Search> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await getAdminListingDetail(id)
  return { title: listing ? listing.title : 'Listing not found' }
}

/** Which panel a checklist item sends someone to. */
const ANCHOR_LABEL: Record<CheckAnchor, string> = {
  details: 'Go to Details',
  photos: 'Go to Photos',
}

/**
 * The one screen where a listing is actually worked on: fields, features, photos and
 * the lifecycle controls.
 *
 * The ARRANGEMENT changed in the v1 admin redesign, the work did not. What used to be five
 * equal panels stacked in a column — with the reasons a publish was unavailable computed on
 * the server and then rendered at the very bottom — is now: what is blocking this listing
 * FIRST, the panels after it, and a section nav that makes the stack navigable instead of
 * scrollable. Every panel is the same component it always was.
 *
 * Everything the client components need is still computed here — which bucket uploads go
 * to, whether the slug may still change, which moves exist from this status, and what is
 * blocking a publish. None of those are decisions a browser gets to make, and each is
 * re-derived inside the action before anything is written.
 */
/**
 * NO SUSPENSE BOUNDARY MAY WRAP THIS PAGE. Not a segment `loading.tsx`, not an in-page
 * `<Suspense>` — both were measured, both break it the same way.
 *
 * Piece 6 added `app/admin/(staff)/loading.tsx` to cure the freeze-then-blink navigation. On
 * Next 16 a boundary above `ListingActionBar` (a client component holding `useActionState`)
 * makes the browser keep TWO copies of this page after a server action's `revalidatePath`
 * re-render — proved by a strict-mode violation where `#lf-title` resolved to two inputs. The
 * stale copy never leaves `pending === true`, so the clerk watches "Working…" forever while
 * the publish has in fact already been written. Measured on `03-listing-journey.spec.ts`:
 * boundary present 11/19, boundary absent 19/19, and moving it into the page changed nothing
 * (5/19) — it is the boundary, not the file convention.
 *
 * So this page navigates the pre-piece-6 way: the router blocks for the ~2 s these five
 * queries take. That is the deliberate trade — a slow navigation beats a control that lies
 * about whether the work happened. The public half of piece 6 (`app/loading.tsx`) is
 * untouched and still streams; only the staff segment gives up its boundary.
 *
 * Fixing this properly means splitting the fetch so the action bar renders from one fast
 * query while the heavy panels stream behind their own boundaries BELOW it. That is a
 * redesign of this page's data loading, not a patch, and it is filed in BACKLOG.md.
 */
export default async function EditListingPage({ params, searchParams }: Props) {
  const { id } = await params
  const search = await searchParams

  const [listing, towns, features, activePropertyTypes, statusHistory] = await Promise.all([
    getAdminListingDetail(id),
    getTownOptions(),
    getFeatureOptions(),
    getPropertyTypeOptions(),
    getListingStatusHistory(id),
  ])

  if (!listing) notFound()

  // The pick list is active, legacy-mapped types only (see getPropertyTypeOptions). A
  // listing already carrying a type the owner has since archived must still show it
  // selected, so it is added back in here rather than silently dropped from the form.
  const propertyTypes =
    listing.propertyType && !activePropertyTypes.some((t) => t.id === listing.propertyType!.id)
      ? [...activePropertyTypes, listing.propertyType]
      : activePropertyTypes

  const backHref = backHrefFrom(one(search.back))
  const isPublic = listing.status === 'live' || listing.status === 'sold'

  // The move this listing is working towards, promoted into the sticky bar. Selling and
  // withdrawing are deliberately NOT here — see ListingActionBar.
  const primary =
    listing.allowedTransitions.find((t) => t.to === 'for_approval' || t.to === 'live') ?? null

  // Everything else `allowedTransitions` offers, behind the bar's "Status" menu — see the
  // doc comment on ListingActionBar for why this replaced a fourth page section.
  const secondary = listing.allowedTransitions.filter((t) => t.to !== primary?.to)

  const outstanding = listing.publishChecklist.filter((item) => !item.done)
  const requiredLeft = outstanding.filter((item) => item.required).length
  // A sold listing has nowhere left to go, and a live one has already passed every check —
  // showing either of them a publish checklist is telling them about work that is done.
  const showChecklist = outstanding.length > 0 && !isPublic
  const photosIncomplete = outstanding.some((item) => item.anchor === 'photos')

  return (
    <>
      <ListingActionBar
        listingId={listing.id}
        status={listing.status}
        statusLabel={listing.statusLabel}
        // Reference first, the same way the public page and every card name it.
        title={displayTitle(listing.propertyNo, listing.title)}
        meta={[
          listing.propertyNo ? null : 'No property number yet',
          listing.categoryLabel,
          listing.townLabel,
          listing.priceLabel,
          listing.updatedAtLabel ? `changed ${listing.updatedAtLabel}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        backHref={backHref}
        publicHref={isPublic ? `/property/${listing.slug}` : null}
        primary={primary}
        secondary={secondary}
        publishedAtLabel={listing.publishedAtLabel}
        soldAtLabel={listing.soldAtLabel}
      />

      <div className="adwrap">
        <nav className="adnav" aria-label="Sections of this listing">
          <a href="#details">Details</a>
          <a href="#features">Features</a>
          <a href="#photos">
            Photos
            {photosIncomplete && <i className="warn" aria-label="incomplete" />}
          </a>
          <a href="#history">History</a>
        </nav>

        <div className="adbody">
          {/* Itemised, at the top, each with a way to go and fix it. This used to be a
              paragraph of grey meta text in the last panel on the page. */}
          {showChecklist && (
            <section className="ablockers" aria-labelledby="blockersH">
              <h2 id="blockersH">
                {requiredLeft > 0
                  ? `${requiredLeft} thing${requiredLeft === 1 ? '' : 's'} left before this can go live`
                  : 'Ready to go live — one suggestion left'}
              </h2>
              <ul>
                {listing.publishChecklist.map((item) => (
                  <li key={item.id} className={item.done ? 'done' : undefined}>
                    <i className={item.done ? 'box done' : 'box'} aria-hidden="true" />
                    <span>
                      {item.label}
                      {!item.done && !item.required && <em> {item.note}</em>}
                    </span>
                    {!item.done && <a href={`#${item.anchor}`}>{ANCHOR_LABEL[item.anchor]}</a>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div id="details">
            <ListingForm
              mode="edit"
              towns={towns}
              propertyTypes={propertyTypes}
              slugEditable={listing.slugEditable}
              statusLabel={listing.statusLabel}
              listing={{
                id: listing.id,
                slug: listing.slug,
                propertyNo: listing.propertyNo,
                title: listing.title,
                propertyTypeId: listing.propertyTypeId,
                frontage: listing.frontage,
                pricePhp: listing.pricePhp,
                townId: listing.townId,
                areaDetail: listing.areaDetail,
                lotAreaSqm: listing.lotAreaSqm,
                floorAreaSqm: listing.floorAreaSqm,
                bedrooms: listing.bedrooms,
                bathrooms: listing.bathrooms,
                description: listing.description,
                isTrending: listing.isTrending,
              }}
            />
          </div>

          <div id="features">
            <FeaturesForm
              listingId={listing.id}
              features={features}
              selectedIds={listing.featureIds}
            />
          </div>

          <div id="photos">
            <PhotoManager
              listingId={listing.id}
              status={listing.status}
              uploadBucket={listing.uploadBucket}
              photos={listing.photos}
            />
          </div>

          {/*
            Written by the listings_record_status_change trigger
            (20260804140000_listing_status_audit_trail.sql), one row per status move —
            nothing here can be edited or deleted from the product, same guarantee as the
            "Recent access changes" trail on the admins screen.
          */}
          <section className="apanel" aria-labelledby="historyH" id="history">
            <h2 id="historyH">History</h2>
            {statusHistory.length ? (
              <div className="alist">
                {statusHistory.map((change) => (
                  <div className="arow" key={change.id}>
                    <div className="t">
                      <b>
                        {change.fromStatusLabel ? `${change.fromStatusLabel} → ` : 'Created as '}
                        {change.toStatusLabel}
                      </b>
                      <span className="meta">
                        By {change.actorName}
                        {change.changedAtLabel ? ` · ${change.changedAtLabel}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <b>No status changes recorded yet</b>
                Submitting for approval, approving, or any other status move writes the
                first line here.
              </div>
            )}
          </section>

          <Link className="crumb" href={backHref}>
            ← Back to listings
          </Link>
        </div>
      </div>
    </>
  )
}
