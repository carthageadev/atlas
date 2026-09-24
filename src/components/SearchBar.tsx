import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { parseQuery } from "../lib/roms";

function QueryText({ value }: { value: string }) {
	return (
		<>
			{value.split(/(\s+)/).map((part, index) => {
				if (!part || /^\s+$/.test(part)) return <span key={index}>{part}</span>;
				const filter = part.match(/^([^:\s]+):(.*)$/);
				const kind = parseQuery(part).tokens[0]?.kind;
				if (filter && kind === "filter") {
					return (
						<span key={index}>
							<span className="text-neutral-500">{filter[1]}:</span>
							<span className="text-acc">{filter[2]}</span>
						</span>
					);
				}
				if (filter && kind === "bad") return <span className="text-red-300/80" key={index}>{part}</span>;
				return <span className="text-neutral-100" key={index}>{part}</span>;
			})}
		</>
	);
}

interface Props {
	value: string;
	onChange: (value: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	inputRef: RefObject<HTMLInputElement | null>;
	active: boolean;
}

export function SearchBar({ value, onChange, onKeyDown, inputRef, active }: Props) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const [focused, setFocused] = useState(false);
	const syncScroll = () => {
		if (overlayRef.current && inputRef.current) overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
	};
	useEffect(syncScroll, [value]);

	return (
		<div className={`relative flex w-full items-center border-b transition-colors duration-150 ease-out ${focused ? "border-acc" : "border-neutral-700 hover:border-neutral-500"} ${active ? "h-12" : "h-14"}`}>
			<span className="mr-4 select-none text-base text-acc">&gt;</span>
			<div className="relative h-full min-w-0 flex-1 text-[15px]">
				<div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre" ref={overlayRef}>
					{value ? <QueryText value={value} /> : <span className="text-neutral-600">search games by name / p:n64 / c:nintendo</span>}
				</div>
				<input
					aria-label="Search the shared ROM index"
					autoCapitalize="off"
					autoComplete="off"
					autoCorrect="off"
					className="absolute inset-0 h-full w-full bg-transparent text-transparent caret-acc outline-none selection:bg-acc/20"
					onBlur={() => setFocused(false)}
					onChange={(event) => onChange(event.target.value)}
					onFocus={() => setFocused(true)}
					onKeyDown={onKeyDown}
					onKeyUp={syncScroll}
					onScroll={syncScroll}
					ref={inputRef}
					spellCheck={false}
					value={value}
				/>
			</div>
			{value ? (
				<button className="ml-4 text-[10px] uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:text-neutral-200" onClick={() => { onChange(""); inputRef.current?.focus(); }} type="button">clear</button>
			) : (
				<span className="ml-4 text-[10px] text-neutral-700">/</span>
			)}
		</div>
	);
}
