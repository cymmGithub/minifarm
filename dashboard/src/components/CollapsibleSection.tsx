import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
	rightContent?: React.ReactNode;
	badge?: React.ReactNode;
}

export function CollapsibleSection({
	title,
	defaultOpen = true,
	children,
	rightContent,
	badge,
}: CollapsibleSectionProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<section className="bg-white border border-slate-200 rounded-lg shadow-sm">
				<div className="flex items-center justify-between p-5">
					<CollapsibleTrigger asChild>
						<button type="button" className="flex items-center gap-2 hover:text-slate-600">
							<ChevronDown
								className={cn(
									'h-5 w-5 text-slate-400 transition-transform',
									!isOpen && '-rotate-90',
								)}
							/>
							<h2 className="text-lg font-semibold text-slate-800">
								{title}
							</h2>
							{badge}
						</button>
					</CollapsibleTrigger>
					{rightContent}
				</div>
				<CollapsibleContent>
					<div className="p-5 pt-4">{children}</div>
				</CollapsibleContent>
			</section>
		</Collapsible>
	);
}
