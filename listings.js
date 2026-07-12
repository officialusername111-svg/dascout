/* DaScout shared data + image fallback. Loaded by index.html and property.html. */

/* fallback placeholder for missing images */
const IMG_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">' +
  '<rect width="300" height="200" fill="#E3EDE7"/>' +
  '<g fill="none" stroke="#8B968F" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M112 102 150 72l38 30v42a6 6 0 0 1-6 6h-64a6 6 0 0 1-6-6z"/>' +
  '<path d="M138 150v-26h24v26"/></g></svg>'
);
function swapToFallback(img){
  if (img.src === IMG_FALLBACK) return;
  img.src = IMG_FALLBACK;
  img.alt = (img.alt ? img.alt + ' ' : '') + '(photo unavailable)';
}
document.addEventListener('error', e => {
  if (e.target instanceof HTMLImageElement) swapToFallback(e.target);
}, true);
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('img').forEach(img => {
    if (img.complete && img.naturalWidth === 0 && img.src) swapToFallback(img);
  });
});

/* Categories: rlot, farm, clot, rbdg, cbdg. All locations in SOCCSKSARGEN. */
const CATS = {
  rlot: { label: 'Residential Lot', pill: 'land' },
  farm: { label: 'Farm Land',       pill: 'farm' },
  clot: { label: 'Commercial Lot',  pill: 'land' },
  rbdg: { label: 'Residential Bldg',pill: 'res'  },
  cbdg: { label: 'Commercial Bldg', pill: 'com'  }
};

const LISTINGS = [
  {
    id: 'dacera-corner-lot', cat: 'rlot', trend: true,
    title: 'Dacera Heights Corner Lot',
    loc: 'Lagao, General Santos City',
    price: '₱2,900,000',
    specs: [['area','240 sqm'], ['check','Titled'], [null,'Corner']],
    desc: 'Fenced corner lot in a quiet Lagao neighborhood, five minutes from Robinsons Place GenSan. Flat, filled, and ready to build, with city water and power at the street.',
    features: ['Titled', 'Corner lot', 'Flat terrain', 'Near schools'],
    photos: ['assets/lots/l09.jpg', 'assets/lots/l10.jpg', 'assets/lots/l04.jpg']
  },
  {
    id: 'morales-view-lot', cat: 'rlot',
    title: 'Morales Heights View Lot',
    loc: 'Koronadal City, South Cotabato',
    price: '₱1,850,000',
    specs: [['area','300 sqm'], ['check','Titled'], [null,'Overlooking']],
    desc: 'Gently elevated lot overlooking the Koronadal valley, in a developing subdivision off the national highway. Clean title, association dues already settled.',
    features: ['Titled', 'Overlooking', 'Subdivision', 'Near highway'],
    photos: ['assets/lots/l06.jpg', 'assets/lots/l11.jpg', 'assets/lots/l07.jpg']
  },
  {
    id: 'cannery-subd-lot', cat: 'rlot',
    title: 'Cannery Road Subdivision Lot',
    loc: 'Polomolok, South Cotabato',
    price: '₱1,200,000',
    specs: [['area','200 sqm'], ['check','Titled'], [null,'Flat']],
    desc: 'Inner lot in an established Polomolok subdivision along the Cannery corridor, between General Santos and Tupi. Ideal starter lot for a young family.',
    features: ['Titled', 'Flat terrain', 'Gated', 'Near Dole Cannery'],
    photos: ['assets/lots/l08.jpg', 'assets/lots/l09.jpg', 'assets/lots/l10.jpg']
  },
  {
    id: 'tupi-rice-farm', cat: 'farm', trend: true,
    title: 'Tupi Irrigated Rice Farm',
    loc: 'Tupi, South Cotabato',
    price: '₱6,800,000',
    specs: [['area','2 ha'], ['check','Titled'], [null,'Irrigated']],
    desc: 'Two hectares of productive irrigated rice land at the foot of Mt. Matutum, harvesting twice a year with NIA canal access. Farm-to-market road on the north boundary.',
    features: ['Titled', 'Irrigated', 'Two croppings/year', 'Road access'],
    photos: ['assets/lots/l13.jpg', 'assets/lots/l14.jpg', 'assets/lots/l12.jpg']
  },
  {
    id: 'lake-sebu-fruit-farm', cat: 'farm',
    title: 'Lake Sebu Fruit Farm',
    loc: 'Lake Sebu, South Cotabato',
    price: '₱4,500,000',
    specs: [['area','1.6 ha'], ['check','Titled'], [null,'Fruit trees']],
    desc: 'Cool-climate farm near the Seven Falls area planted with durian, lanzones, and banana. Includes a small caretaker hut and spring water source.',
    features: ['Titled', 'With fruit trees', 'Water source', 'Caretaker hut'],
    photos: ['assets/lots/l15.jpg', 'assets/lots/l16.jpg', 'assets/lots/l17.jpg']
  },
  {
    id: 'mlang-coconut-grove', cat: 'farm',
    title: "M'lang Coconut Grove",
    loc: "M'lang, Cotabato",
    price: '₱3,900,000',
    specs: [['area','1.2 ha'], ['check','Titled'], [null,'Coconut']],
    desc: 'Mature coconut stand with a shaded access road, steady copra income, and space to intercrop cacao or coffee. Boundary markers freshly surveyed.',
    features: ['Titled', 'Income-generating', 'Road access', 'Freshly surveyed'],
    photos: ['assets/lots/l17.jpg', 'assets/lots/l12.jpg', 'assets/lots/l16.jpg']
  },
  {
    id: 'bula-highway-lot', cat: 'clot', trend: true,
    title: 'National Highway Frontage Lot',
    loc: 'Bula, General Santos City',
    price: '₱12,500,000',
    specs: [['area','850 sqm'], [null,'28m frontage'], [null,'Flat']],
    desc: 'High-visibility commercial lot fronting the national highway near the Bula fish port junction. Suited for a fuel station, showroom, or commissary.',
    features: ['Highway frontage', 'Flat terrain', 'High traffic', 'Utilities at street'],
    photos: ['assets/lots/l05.jpg', 'assets/lots/l04.jpg', 'assets/lots/l08.jpg']
  },
  {
    id: 'villa-consuelo-home', cat: 'rbdg', trend: true,
    title: 'Villa Consuelo Modern Home',
    loc: 'Calumpang, General Santos City',
    price: '₱9,800,000',
    specs: [['bed','4'], ['bath','3'], ['area','250 sqm']],
    desc: 'Three-storey modern home with a roof deck facing Sarangani Bay breezes. Open-plan kitchen and living, maid’s room, and a two-car garage.',
    features: ['With garage', 'Roof deck', 'Newly built', 'Gated'],
    photos: ['assets/houses/h08.jpg', 'assets/houses/h15.png', 'assets/houses/h14.jpg']
  },
  {
    id: 'rosario-bungalow', cat: 'rbdg',
    title: 'Rosario Garden Bungalow',
    loc: 'Koronadal City, South Cotabato',
    price: '₱4,200,000',
    specs: [['bed','3'], ['bath','2'], ['area','140 sqm']],
    desc: 'Well-kept bungalow on a fenced 300 sqm lot near the Koronadal city plaza. Mango tree out front, deep well plus city water, and a covered carport.',
    features: ['With garden', 'With garage', 'Fenced', 'Near plaza'],
    photos: ['assets/houses/h05.jpg', 'assets/houses/h06.jpg', 'assets/houses/h04.jpg']
  },
  {
    id: 'mt-apo-family-home', cat: 'rbdg',
    title: 'Mt. Apo View Family Home',
    loc: 'Kidapawan City, Cotabato',
    price: '₱7,500,000',
    specs: [['bed','4'], ['bath','3'], ['area','200 sqm']],
    desc: 'Two-storey family home in a gated Kidapawan subdivision with Mt. Apo views from the upstairs veranda. Walking distance to schools and the public market.',
    features: ['Gated', 'Mountain view', 'Near schools', 'With garage'],
    photos: ['assets/houses/h02.jpg', 'assets/houses/h13.jpg', 'assets/houses/h12.jpg']
  },
  {
    id: 'tacurong-apartments', cat: 'rbdg',
    title: 'Tacurong 8-Door Apartments',
    loc: 'Tacurong City, Sultan Kudarat',
    price: '₱18,500,000',
    specs: [['home','8 doors'], ['area','620 sqm'], [null,'Income']],
    desc: 'Fully tenanted eight-door apartment row near Notre Dame of Tacurong College. Consistent occupancy from students and teachers; books available for review.',
    features: ['Income-generating', 'Fully tenanted', 'Near college', 'Titled'],
    photos: ['assets/houses/h10.jpg', 'assets/houses/h09.jpg', 'assets/houses/h07.jpg']
  },
  {
    id: 'santiago-retail-arcade', cat: 'cbdg',
    title: 'Santiago Retail Arcade',
    loc: 'Santiago Blvd, General Santos City',
    price: '₱35,000,000',
    specs: [[null,'3 floors'], ['area','780 sqm'], [null,'Corner']],
    desc: 'Corner commercial building on Santiago Boulevard with ground-floor retail, second-floor offices, and top-floor storage. Nine of ten units currently leased.',
    features: ['Corner', 'Income-generating', 'High foot traffic', 'Titled'],
    photos: ['assets/cbldg.jpg', 'assets/card9.jpg', 'assets/houses/h15.png']
  }
];

function getListing(id){ return LISTINGS.find(l => l.id === id); }

/* spec icons available in the page sprite */
function specHTML(specs){
  return specs.map(([icon, text]) =>
    icon ? `<span><svg class="icon" aria-hidden="true"><use href="#i-${icon}"/></svg>${text}</span>`
         : `<span>${text}</span>`
  ).join('');
}
