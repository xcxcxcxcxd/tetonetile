import { h, render, Fragment, createContext } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);
export { h, render, Fragment, createContext };
