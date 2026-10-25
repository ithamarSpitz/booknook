export const SHELF_KINDS = Object.freeze({
  READING: "reading",
  READ: "read",
  WANT: "want",
  STOPPED: "stopped",
  CUSTOM: "custom",
});

export const FUNCTIONS = Object.freeze({
  ADD_BOOK: "add-book",
  BOOK_DETAILS: "book-details",
  LINK_EDITION: "link-edition",
  RECOMMENDATIONS: "recommendations",
});

export const ROUTES = Object.freeze({
  LIBRARY: "#library",
  RECOMMENDATIONS: "#recs",
  SEARCH: "#search",
  SETTINGS: "#settings",
  LOGIN: "#login",
});

export const RPCS = Object.freeze({
  MOVE_BOOK: Object.freeze({
    name: "move_book",
    params: Object.freeze(["p_simania_id", "p_to_shelf", "p_to_position"]),
  }),
  MOVE_SHELF: Object.freeze({
    name: "move_shelf",
    params: Object.freeze(["p_shelf_id", "p_to_position"]),
  }),
  DELETE_SHELF: Object.freeze({
    name: "delete_shelf",
    params: Object.freeze(["p_shelf_id"]),
  }),
  REMOVE_BOOK: Object.freeze({
    name: "remove_book",
    params: Object.freeze(["p_simania_id"]),
  }),
});

/**
 * @typedef {Object} BookCard
 * @property {number} simania_id
 * @property {string|null} work_id
 * @property {'pending'|'wikidata'|'nli'|'fuzzy'|'llm'|'not_found'} resolve_status
 * @property {string} title
 * @property {string|null} author
 * @property {string|null} translator
 * @property {string|null} publisher
 * @property {string|null} series
 * @property {string|null} category
 * @property {number|null} year
 * @property {number|null} pages
 * @property {string|null} description
 * @property {string|null} cover_url
 * @property {number|null} simania_rating
 * @property {number|null} simania_rating_count
 * @property {string|null} shelf_id
 * @property {string|null} shelf_name
 * @property {'reading'|'read'|'want'|'stopped'|'custom'|null} shelf_kind
 * @property {number|null} position
 * @property {string|null} added_at
 * @property {string|null} finished_at
 * @property {number|null} rating
 */

/**
 * @typedef {Object} RecommendationCard
 * @property {string} work_id
 * @property {number|null} simania_id
 * @property {string} title
 * @property {string|null} author
 * @property {string|null} cover_url
 * @property {number} score
 * @property {number[]} because
 * @property {string[]} because_titles
 * @property {string[]} shared_tags
 * @property {boolean} dismissed
 * @property {string} generated_at
 * @property {boolean} english_only
 * @property {boolean} can_add
 * @property {{source: 'wikidata'|'nli', title: string, author: string|null}|null} hebrew_hint English-only: Hebrew title for the browser's Simania match
 */

