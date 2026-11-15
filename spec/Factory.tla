---------------------------- MODULE Factory ----------------------------
\* One task's life in the factory.
\* A parent Opus coordinator session picks each next step; the engine only
\* lets it take steps this spec allows. Humans act only at gates, plus
\* parking and unparking cards on the kanban board.
EXTENDS Naturals

CONSTANT Cap            \* 3: max send-backs per gate, and per automatic loop

Gates == {"ResearchGate","PlanGate","PRGate","NeedsYou"}
Parkable == {"Queued","Backlog","ResearchGate","PlanGate","PRGate","NeedsYou"}
States == {"Inbox","Triage","Ignored","ReplyDrafted","Replied","Queued","Backlog",
           "Researching","ResearchCheck","ResearchGate",
           "Planning","RequirementsReview","PlanGate",
           "Building","Reviewing","Confirming","PRGate",
           "NeedsYou","Parked","Done","Dropped"}
Terminal == {"Ignored","Replied","Done","Dropped"}
Loops == {"check","requirements","review","confirm"}
\* A research task stops after its research is reviewed and approved: no plan, no build
Kinds == {"change","research"}

VARIABLES st,         \* where the task is
          tries,      \* send-backs used, per gate (never reset)
          loops,      \* automatic loops used (never reset)
          chart,      \* research produced a statechart
          proved,     \* its TLA+ model passed TLC
          covered,    \* an independent review traced every source requirement into the plan
          findings,   \* compiled code + security review found blocking issues
          confirmed,  \* the change was run and shown to solve the problem
          approved,   \* human approvals collected so far
          parkedFrom, \* where a parked card returns to
          kind        \* change or research, fixed when the task is created
vars == <<st, tries, loops, chart, proved, covered, findings, confirmed, approved, parkedFrom, kind>>
work == <<tries, loops, chart, proved, covered, findings, confirmed, approved>>

Init == /\ st = "Inbox" /\ tries = [g \in Gates |-> 0] /\ loops = [l \in Loops |-> 0]
        /\ chart = FALSE /\ proved = FALSE /\ covered = FALSE /\ findings = FALSE /\ confirmed = FALSE
        /\ approved = {} /\ parkedFrom = "Queued" /\ kind \in Kinds

Go(s) == st' = s
Same == UNCHANGED <<work, parkedFrom>>
Bump(l) == loops' = [loops EXCEPT ![l] = @ + 1]

\* Intake and triage
Pick      == st = "Inbox"  /\ Go("Triage") /\ Same
TIgnore   == st = "Triage" /\ Go("Ignored") /\ Same
TReply    == st = "Triage" /\ Go("ReplyDrafted") /\ Same
SendReply == st = "ReplyDrafted" /\ Go("Replied") /\ Same
\* You decide a drafted reply isn't needed after all
Dismiss   == st = "ReplyDrafted" /\ Go("Ignored") /\ Same
\* You overrule triage: an ignored item or a drafted reply becomes a task
Promote   == st \in {"Ignored","ReplyDrafted"} /\ Go("Queued") /\ Same
TTask     == st = "Triage" /\ Go("Queued") /\ Same
\* Worth doing, but not now: waits in the backlog and never takes a slot on its own
TBacklog  == st = "Triage" /\ Go("Backlog") /\ Same
\* You move work between the queue and the backlog
Demote     == st = "Queued" /\ Go("Backlog") /\ Same
Prioritize == st = "Backlog" /\ Go("Queued") /\ Same
Start     == st = "Queued" /\ Go("Researching") /\ Same

\* Research: must ship a statechart and a TLC-checked model
Research   == /\ st = "Researching" /\ Go("ResearchCheck") /\ chart' = TRUE
              /\ proved' \in BOOLEAN
              /\ UNCHANGED <<tries,loops,covered,findings,confirmed,approved,parkedFrom>>
\* A research task's research gets the independent review before you see it
CheckPass  == /\ st = "ResearchCheck" /\ chart /\ proved
              /\ Go(IF kind = "research" THEN "RequirementsReview" ELSE "ResearchGate") /\ Same
CheckRetry == /\ st = "ResearchCheck" /\ ~proved /\ loops["check"] < Cap
              /\ Go("Researching") /\ Bump("check")
              /\ UNCHANGED <<tries,chart,proved,covered,findings,confirmed,approved,parkedFrom>>
CheckOut   == st = "ResearchCheck" /\ ~proved /\ loops["check"] = Cap /\ Go("NeedsYou") /\ Same

\* Human gates: approve, send back (max Cap per gate), drop
Approve(g, next, tag) ==
    /\ st = g /\ Go(next) /\ approved' = approved \cup {tag}
    /\ UNCHANGED <<tries,loops,chart,proved,covered,findings,confirmed,parkedFrom>>
SendBack(g, back, clear) ==
    /\ st = g /\ tries[g] < Cap /\ Go(back)
    /\ tries' = [tries EXCEPT ![g] = @ + 1]
    /\ approved' = approved \ clear
    /\ IF back = "Researching" THEN chart' = FALSE /\ proved' = FALSE
                               ELSE UNCHANGED <<chart,proved>>
    /\ IF back \in {"Researching","Planning"} THEN covered' = FALSE ELSE UNCHANGED covered
    /\ UNCHANGED <<loops,findings,confirmed,parkedFrom>>
Drop(g) == st = g /\ Go("Dropped") /\ Same
BDrop == Drop("Backlog")

\* Research is reviewed in Notion (comments there); the app records one overall verdict
RGate == \/ Approve("ResearchGate", IF kind = "research" THEN "Done" ELSE "Planning", "research")
         \/ SendBack("ResearchGate","Researching",{})
         \/ Drop("ResearchGate")
\* Planning splits the work into small tickets on your Notion factory board
Plan  == st = "Planning" /\ Go("RequirementsReview") /\ Same
\* A separate session rereads the original Slack message or Jira ticket and traces
\* every requirement into the research and the plan before you see the plan
ReqReview == /\ st = "RequirementsReview" /\ covered' \in BOOLEAN
             /\ IF covered' THEN Go(IF kind = "research" THEN "ResearchGate" ELSE "PlanGate")
                ELSE IF loops["requirements"] < Cap THEN Go(IF kind = "research" THEN "Researching" ELSE "Planning")
                ELSE Go("NeedsYou")
             /\ IF ~covered' /\ loops["requirements"] < Cap THEN Bump("requirements") ELSE UNCHANGED loops
             /\ UNCHANGED <<tries,chart,proved,findings,confirmed,approved,parkedFrom>>
PGate == \/ Approve("PlanGate","Building","plan")
         \/ SendBack("PlanGate","Planning",{})
         \/ SendBack("PlanGate","Researching",{"research"})
         \/ Drop("PlanGate")

\* Build loop: no human gate until the PR is ready
Build    == /\ st = "Building" /\ Go("Reviewing") /\ findings' \in BOOLEAN
            /\ confirmed' = FALSE
            /\ UNCHANGED <<tries,loops,chart,proved,covered,approved,parkedFrom>>
Rework   == st = "Reviewing" /\ findings /\ loops["review"] < Cap /\ Go("Building")
            /\ Bump("review") /\ UNCHANGED <<tries,chart,proved,covered,findings,confirmed,approved,parkedFrom>>
ReviewOut == st = "Reviewing" /\ findings /\ loops["review"] = Cap /\ Go("NeedsYou") /\ Same
Clean    == st = "Reviewing" /\ ~findings /\ Go("Confirming") /\ Same
\* run it and check it really solves the problem the ticket describes
Confirm  == /\ st = "Confirming" /\ confirmed' \in BOOLEAN
            /\ IF confirmed' THEN Go("PRGate")
               ELSE IF loops["confirm"] < Cap THEN Go("Building") ELSE Go("NeedsYou")
            /\ IF ~confirmed' /\ loops["confirm"] < Cap THEN Bump("confirm") ELSE UNCHANGED loops
            /\ UNCHANGED <<tries,chart,proved,covered,findings,approved,parkedFrom>>

\* First human look at the code: a PR that is reviewed, fixed and confirmed
PRGateStep == \/ Approve("PRGate","Done","pr")
              \/ SendBack("PRGate","Building",{})
              \/ SendBack("PRGate","Planning",{"plan"})
              \/ Drop("PRGate")

\* Needs you: also a gate, also capped
NGate == \/ SendBack("NeedsYou","Researching",{"research","plan"})
         \/ /\ {"research","plan"} \subseteq approved
            /\ SendBack("NeedsYou","Building",{})
         \/ Drop("NeedsYou")

\* Stop a running stage: it goes to Needs you, whose cap still applies
Running == {"Researching","Planning","RequirementsReview","Building","Reviewing","Confirming"}
Interrupt == st \in Running /\ Go("NeedsYou") /\ Same

\* Kanban: park and unpark
Park   == st \in Parkable /\ Go("Parked") /\ parkedFrom' = st /\ UNCHANGED work
Unpark == st = "Parked" /\ Go(parkedFrom) /\ Same
PDrop  == Drop("Parked")

Finished == st \in Terminal /\ UNCHANGED vars

Steps == \/ Pick \/ TIgnore \/ TReply \/ SendReply \/ Dismiss \/ Promote \/ TTask \/ Start
        \/ TBacklog \/ Demote \/ Prioritize \/ BDrop
        \/ Research \/ CheckPass \/ CheckRetry \/ CheckOut
        \/ RGate \/ Plan \/ ReqReview \/ PGate
        \/ Build \/ Rework \/ ReviewOut \/ Clean \/ Confirm \/ PRGateStep
        \/ NGate \/ Interrupt \/ Park \/ Unpark \/ PDrop \/ Finished
Next == Steps /\ UNCHANGED kind

\* Steps the factory or a person must eventually take. Parking, overriding triage
\* and interrupting are your choice, so fairness never forces them. (Listed
\* positively: "Next /\ ~Interrupt" would also rule out a ReviewOut step,
\* because both move to NeedsYou with nothing else changed.)
Moves == \/ Pick \/ TIgnore \/ TReply \/ SendReply \/ TTask \/ TBacklog \/ Start
            \/ Research \/ CheckPass \/ CheckRetry \/ CheckOut
            \/ RGate \/ Plan \/ ReqReview \/ PGate
            \/ Build \/ Rework \/ ReviewOut \/ Clean \/ Confirm \/ PRGateStep
            \/ NGate \/ PDrop
Progress == Moves /\ UNCHANGED kind
Spec == Init /\ [][Next]_vars /\ WF_vars(Progress)

\* What must always hold
TypeOK == /\ st \in States /\ parkedFrom \in Parkable
          /\ tries \in [Gates -> 0..Cap] /\ loops \in [Loops -> 0..Cap]
          /\ approved \subseteq {"research","plan","pr"} /\ kind \in Kinds
\* Nothing passes the research gate without a statechart and a passing check
ResearchRule == st \in {"ResearchGate","Planning","RequirementsReview","PlanGate","Building",
                        "Reviewing","Confirming","PRGate","Done"} => chart /\ proved
\* You only see a plan that traces back to every requirement in the original source
CoverageRule == (st \in {"PlanGate","Building","Reviewing","Confirming","PRGate","Done"}
                 \/ (kind = "research" /\ st = "ResearchGate")) => covered
\* Building only starts on approved research and an approved plan
BuildRule == st \in {"Building","Reviewing","Confirming","PRGate"}
             => {"research","plan"} \subseteq approved
\* A human sees the code only once review is clean and the fix is confirmed
PRRule == st = "PRGate" => ~findings /\ confirmed
\* Done only after research, plan and PR are all approved; a research task needs only its research approved
GatesRule == st = "Done" => approved = IF kind = "research" THEN {"research"} ELSE {"research","plan","pr"}
\* Every task ends, or waits in Parked or the Backlog until you pick it up
EndsOrParked == <>(st \in Terminal \cup {"Parked","Backlog"})
=============================================================================
