# Interview: agency owner on the Meta fleet dashboard

**Date**: 2026-07-25
**Subject**: agency owner (the buyer persona for Adomata)
**Language**: recorded in Russian; digest below is English. This file is the source document for the
[Meta fleet dashboard](../../CONTEXT.md) wayfinder effort — tickets cite it rather than re-quoting it.

## Digest

### The problem

Meta gives each Ad Account its own silo. To see statistics, campaigns, or ad sets you switch into one
account at a time. The hierarchy inside an account is Campaign → Ad Set → Ad. Meta's own interface is
workable but inconvenient.

Critically: **there is no tool that shows the state of every Ad Account at once.** That gap is the
product.

### What he wants

A dashboard with **configurable view depth**:

- **Brief view** — active accounts, their current amount owed, and whether campaigns are running in
  them or not.
- **Expand a level** — also see the running campaigns.
- **Expand further** — click a campaign to see its ad sets, and below that, its ads.
- **Ideal** — reach all the way down to creatives.

**Quick metric toggles.** Meta exposes a large number of metrics. He wants to choose which are
displayed — but through fast, operational switches, not by descending into deep settings menus.

**Traffic-light colour coding on accounts:**

| Colour | Meaning (his words)                                    |
| ------ | ------------------------------------------------------ |
| Green  | active account                                         |
| Yellow | on deferred payment terms                              |
| Red    | something is wrong — money owed, or the account is blocked |

### Why it matters — three personas

- **Media buyer (таргетолог)** — sees where the problem is immediately, instead of touring accounts
  on a schedule to find out.
- **Project manager** — good operational visibility.
- **Agency director** — can glance at the client list and see whether a specific client is fine.

### On creatives

Reaching creative level "would be just ideal". In Meta, reviewing each creative means clicking
buttons on the ad, one at a time — inconvenient, while *which creative produces results* is the
important question. He notes that pulling creatives out via the API is in fact possible, so if this
could be made usable it would be very valuable.

### Reference

He mentioned an existing rough prototype he intended to show ("I'll show you what was made, and
you'll understand roughly how it looks"). **Not available to us** — this effort works from the
interview text alone.

## Original transcript (ru)

> Значит, У Мета есть рекламные кабинеты. На каждый кабинет нужно переключаться отдельно. Тогда можно
> видеть статистику, можно видеть компании, группы объявлений. Там такая структура иерархическая.
> Есть компании. Каждая компания может содержать какое-то количество групп объявлений. Каждая группа
> объявлений содержит какое-то количество объявлений. Интерфейс у Мета не самый удобный. скажем так,
> то есть работать можно, но неудобно. Вот, и нет инструмента, который может показать состояние дел
> всех кабинетов компании, например. Вот, и вот интересно сделать дашборд, который может показывать в
> зависимости от настроек разные виды Ну, отображения, да, то есть какие-то сделать настройки вида, то
> есть, например, краткий вид – это просто активные аккаунты, их задолженности на текущий момент и
> там запущены, не запущены в них компании. Потом было бы неплохо, чтобы можно было расширять глубину
> просмотра, например, смотреть также запущенные кампании. А может быть, можно было бы еще и клацать
> кампании и видеть иерархию групп объявлений. Вот, то есть я покажу то, что сделал гопинат пробу, и
> вы поймете, как это выглядит приблизительно. Вот, и учитывая, что у Фейсбука есть внутри там куча
> разных метрик, было бы неплохо иметь такую систему, которая позволяет также видеть объявления, и
> настраивать, какие метрики отображать, какие нет, причем делать это довольно-таки быстро, то есть
> не залазить в какие-то там глубокие настройки и показывать, что отображать, что нет, а быстрые
> какие-то переключатели, оперативные, тогда четко сразу понятно, там, цветовую гамму также задать,
> например, зеленый активный кабинет, желтый там в отсрочке платежей, красный, с кабинетом что-то не
> так, задолженность или заблокирован. Ну, вот такие вот моменты. И дальше этот функционал можно
> расширять. Что он дает? Он дает таргетологу быстрое понимание, где проблема. То есть не планово
> гулять по кабинетам, а быстро можно видеть. Он дает очень хорошую оперативную информацию
> проект-менеджеру, и директору компании. То есть можно быстро посмотреть и увидеть, все ли в порядке
> у конкретного клиента в списке клиентов. Вот. Ну, вот в принципе, в принципе, если дойти там в
> глубине до уровня креативов, это было бы вообще просто идеально. То есть когда можно доходить до
> креативов. Потому что в Фейсбуке это очень неудобно сделано, и каждый креатив нужно просматривать,
> по сути, нажимая... на объявлении, кнопочки. Ну, неудобно. В то время как это очень важно, какой
> креатив дает результат. Соответственно, если бы было... А возможность выгружать креативы на самом
> деле есть по API. Поэтому, если бы это можно было сделать, и оно бы было, ну, как это, юзабельно,
> то это было бы очень здорово.

## Terminology notes (for domain modelling)

The owner says **кабинет** ("cabinet") for what `CONTEXT.md` calls an **Ad Account** — the glossary
already lists "Cabinet" under _Avoid_. He also says **компания** for Meta's **Campaign** (a homophone
slip for «кампания»); in the same sentence he uses **компания** for the agency itself. Read from
context: the hierarchy he describes is Campaign → Ad Set → Ad, matching Meta's own.

**задолженность** = amount owed / outstanding balance on the Ad Account.
**отсрочка платежей** = deferred payment terms (a credit line rather than prepay).
