// What both processes say a feed's address is (issue 598): the New project
// sheet before it sends one, and the registry gate in the main process
// before the engine is asked to fetch it.

/**
 * Whether a typed address is a feed's address: `http://` or `https://`, in
 * any case, then at least one character and no whitespace anywhere. The
 * sheet trims what was typed first; the main process judges what it was
 * sent, as sent.
 */
export const isFeedUrl = (address: string): boolean => /^https?:\/\/\S+$/i.test(address)
